import fs from 'node:fs'
import path from 'node:path'
import fastifyCookie from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerAdminRoutes } from './admin/routes.ts'
import { registerAuthHook } from './auth/hook.ts'
import { registerAuthRoutes } from './auth/routes.ts'
import { Sessions } from './auth/sessions.ts'
import { SetupToken } from './auth/setup.ts'
import { BoardRooms, type RoomOptions } from './boards/rooms.ts'
import { purgeTrash, registerBoardRoutes } from './boards/routes.ts'
import type { Config } from './config.ts'
import type { AppContext } from './context.ts'
import { openDatabase } from './db/index.ts'
import { registerEmailRoutes } from './email/routes.ts'
import { type EmailOptions, EmailService } from './email/service.ts'
import { registerFileRoutes } from './files/routes.ts'
import { registerItemRoutes } from './items/routes.ts'
import { ItemService } from './items/service.ts'
import { registerShareRoutes } from './items/share.ts'
import { JobQueue, type QueueOptions } from './jobs/queue.ts'
import { originGuard } from './lib/originGuard.ts'
import type { SafeFetchOptions } from './lib/safeFetch.ts'
import { securityHeaders } from './lib/securityHeaders.ts'
import { registerMeRoutes } from './me/routes.ts'
import { collectBoardFiles, dailyBackup } from './ops/maintenance.ts'
import { processorJobs } from './processors/index.ts'
import { RealtimeHub } from './realtime/hub.ts'
import { attachSocketServer } from './realtime/socket.ts'
import { registerCspReportRoute } from './routes/cspReport.ts'
import { registerHealthRoutes } from './routes/health.ts'
import { registerManifestRoute } from './routes/manifest.ts'
import { registerStatic } from './routes/static.ts'
import { SearchIndex } from './search/index.ts'
import { registerSearchRoutes } from './search/routes.ts'
import { type TelegramOptions, TelegramService } from './telegram/bot.ts'
import { registerTelegramRoutes } from './telegram/routes.ts'

declare module 'fastify' {
  interface FastifyInstance {
    telegram: TelegramService
  }
}

const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000
const BACKUP_CHECK_MS = 10 * 60 * 1000

export type BuildOptions = {
  rooms?: Partial<RoomOptions>
  queue?: Partial<QueueOptions>
  /** Tests: let the link preview reach a local test server. */
  fetchOptions?: Partial<SafeFetchOptions>
  /** Tests: receive the JSON log lines (e.g. to read the setup link). */
  logStream?: { write: (line: string) => void }
  /** Tests: DNS answers for DKIM keys. */
  email?: EmailOptions
  /** Tests: mocked Bot API. */
  telegram?: TelegramOptions
}

export async function buildApp(config: Config, options: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      serializers: {
        // Never log query strings: they may carry tokens (PLAN.md 8.7).
        req: (request) => ({
          method: request.method,
          url: request.url.split('?')[0],
          remoteAddress: request.ip,
        }),
      },
      ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    trustProxy: config.TRUSTED_PROXIES.length > 0 ? config.TRUSTED_PROXIES : false,
    bodyLimit: 1024 * 1024,
  })

  // Leftovers of interrupted uploads (PLAN.md 5.2).
  const tmpDir = path.join(config.DATA_DIR, 'tmp')
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.mkdirSync(tmpDir, { recursive: true })

  const database = await openDatabase(config.DATA_DIR, config.MIGRATIONS_DIR, app.log)
  const hub = new RealtimeHub()
  const items = new ItemService(database.db, hub, app.log, config.DATA_DIR)
  const email = new EmailService(database.db, items, app.log, config.DATA_DIR, tmpDir, options.email)
  const queue = new JobQueue(
    database.db,
    app.log,
    {
      ...processorJobs({
        items,
        tmpDir,
        ocrLangs: config.OCR_ENABLED ? config.OCR_LANGS : null,
        whisperUrl: config.TRANSCRIBE_ENABLED ? config.WHISPER_URL : null,
        ...(options.fetchOptions ? { fetchOptions: options.fetchOptions } : {}),
      }),
      ingest_email: {
        concurrency: 1,
        heavy: false,
        handler: (payload) => email.process(String(payload.emailId)),
        onFailed: (payload, error) => email.failed(String(payload.emailId), error),
      },
    },
    options.queue,
  )
  items.attachQueue(queue)
  const search = new SearchIndex(database.db, database.sqlite)
  items.onIndex = (itemId) => search.indexItem(itemId)
  items.onRemoved = (itemId) => search.removeItem(itemId)
  email.attachQueue(queue)
  const telegram = new TelegramService(database.db, items, app.log, tmpDir, config.TELEGRAM_BOT_TOKEN, options.telegram)
  const ctx: AppContext = {
    config,
    log: app.log,
    database,
    sessions: new Sessions(database.db),
    setup: new SetupToken(database.db, config.PUBLIC_URL, app.log),
    rooms: new BoardRooms(database.db, hub, app.log, options.rooms),
    hub,
    items,
    queue,
    telegram,
    email,
    search,
  }
  ctx.rooms.onSaved = (boardId, elements) => {
    items.reconcileBoard(boardId, elements)
    search.indexBoardTexts(boardId, elements)
  }

  await app.register(fastifyCookie)
  await app.register(fastifyMultipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 50, fields: 20, fieldSize: 64 * 1024 },
  })

  app.addHook('onSend', securityHeaders)
  app.addHook('onRequest', originGuard(config))
  registerAuthHook(app, ctx)

  registerHealthRoutes(app, ctx)
  registerCspReportRoute(app)
  registerManifestRoute(app, config)
  registerAuthRoutes(app, ctx)
  registerMeRoutes(app, ctx)
  registerAdminRoutes(app, ctx)
  registerBoardRoutes(app, ctx)
  registerFileRoutes(app, ctx)
  registerItemRoutes(app, ctx)
  registerShareRoutes(app, ctx)
  registerTelegramRoutes(app, ctx)
  registerEmailRoutes(app, ctx)
  registerSearchRoutes(app, ctx)
  // Tests feed updates through it.
  app.decorate('telegram', telegram)
  await registerStatic(app, config)

  const io = attachSocketServer(app, ctx)
  hub.attach(io)

  const maintenance = () => {
    try {
      ctx.sessions.purgeExpired()
      const purged = purgeTrash(database.db)
      if (purged > 0) app.log.info({ purged }, 'boards removed from trash')
      search.prune()
      const purgedItems = items.purgeTrash()
      if (purgedItems > 0) app.log.info({ purged: purgedItems }, 'items removed from trash')
      queue.purgeFinished()
      telegram.purgeOld()
      email.purgeOld()
      const collected = collectBoardFiles(database.db, config.DATA_DIR)
      if (collected > 0) app.log.info({ removed: collected }, 'unused board images removed')
    } catch (error) {
      app.log.error({ err: error }, 'maintenance failed')
    }
  }
  const maintenanceTimer = setInterval(maintenance, MAINTENANCE_INTERVAL_MS)
  maintenanceTimer.unref()

  // backup_db (PLAN.md 7.6): checked every 10 minutes, runs once a day from 03:30.
  const backup = () =>
    dailyBackup(database.sqlite, config.DATA_DIR).then(
      (file) => file && app.log.info({ file: path.basename(file) }, 'daily database backup written'),
      (error: unknown) => app.log.error({ err: error }, 'daily database backup failed'),
    )
  const backupTimer = setInterval(() => void backup(), BACKUP_CHECK_MS)
  backupTimer.unref()

  app.addHook('onReady', async () => {
    maintenance()
    void backup()
    // First start with the search index (Phase 7): build it and fetch reading texts of old links.
    if (search.isEmpty()) {
      search.rebuild()
      for (const id of items.linksWithoutArticle()) queue.enqueue('extract_article', { itemId: id })
    }
    // Text recognition for images and PDFs from before Phase 8 (once; ocrDone marks them).
    if (config.OCR_ENABLED) {
      const pending = items.withoutOcr()
      for (const { id, kind } of pending)
        queue.enqueue(kind === 'pdf' ? 'ocr_pdf' : 'ocr_image', { itemId: id }, { priority: -1 })
      if (pending.length > 0) app.log.info({ count: pending.length }, 'text recognition queued for existing items')
    }
    ctx.setup.init()
    queue.start()
    telegram.start()
  })

  // Shutdown (SIGTERM): persist all open boards, then close the database (PLAN.md 5.3).
  app.addHook('preClose', async () => {
    clearInterval(maintenanceTimer)
    clearInterval(backupTimer)
    await telegram.stop()
    // Leaving clients save their boards; then flush whatever is still dirty.
    io.disconnectSockets(true)
    io.engine.close()
    ctx.rooms.close()
    await queue.stop()
  })
  app.addHook('onClose', async () => {
    database.sqlite.close()
  })

  return app
}
