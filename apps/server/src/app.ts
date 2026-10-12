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
import { registerFileRoutes } from './files/routes.ts'
import { registerItemRoutes } from './items/routes.ts'
import { ItemService } from './items/service.ts'
import { registerShareRoutes } from './items/share.ts'
import { JobQueue, type QueueOptions } from './jobs/queue.ts'
import { originGuard } from './lib/originGuard.ts'
import type { SafeFetchOptions } from './lib/safeFetch.ts'
import { registerMeRoutes } from './me/routes.ts'
import { processorJobs } from './processors/index.ts'
import { RealtimeHub } from './realtime/hub.ts'
import { attachSocketServer } from './realtime/socket.ts'
import { registerHealthRoutes } from './routes/health.ts'
import { registerManifestRoute } from './routes/manifest.ts'
import { registerStatic } from './routes/static.ts'

const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000

export type BuildOptions = {
  rooms?: Partial<RoomOptions>
  queue?: Partial<QueueOptions>
  /** Tests: let the link preview reach a local test server. */
  fetchOptions?: Partial<SafeFetchOptions>
  /** Tests: receive the JSON log lines (e.g. to read the setup link). */
  logStream?: { write: (line: string) => void }
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
  const queue = new JobQueue(
    database.db,
    app.log,
    processorJobs({ items, tmpDir, ...(options.fetchOptions ? { fetchOptions: options.fetchOptions } : {}) }),
    options.queue,
  )
  items.attachQueue(queue)
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
  }
  ctx.rooms.onSaved = (boardId, elements) => items.reconcileBoard(boardId, elements)

  await app.register(fastifyCookie)
  await app.register(fastifyMultipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 50, fields: 20, fieldSize: 64 * 1024 },
  })

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  })
  app.addHook('onRequest', originGuard(config))
  registerAuthHook(app, ctx)

  registerHealthRoutes(app, ctx)
  registerManifestRoute(app, config)
  registerAuthRoutes(app, ctx)
  registerMeRoutes(app, ctx)
  registerAdminRoutes(app, ctx)
  registerBoardRoutes(app, ctx)
  registerFileRoutes(app, ctx)
  registerItemRoutes(app, ctx)
  registerShareRoutes(app, ctx)
  await registerStatic(app, config)

  const io = attachSocketServer(app, ctx)
  hub.attach(io)

  const maintenance = () => {
    try {
      ctx.sessions.purgeExpired()
      const purged = purgeTrash(database.db)
      if (purged > 0) app.log.info({ purged }, 'boards removed from trash')
      const purgedItems = items.purgeTrash()
      if (purgedItems > 0) app.log.info({ purged: purgedItems }, 'items removed from trash')
      queue.purgeFinished()
    } catch (error) {
      app.log.error({ err: error }, 'maintenance failed')
    }
  }
  const maintenanceTimer = setInterval(maintenance, MAINTENANCE_INTERVAL_MS)
  maintenanceTimer.unref()

  app.addHook('onReady', async () => {
    maintenance()
    ctx.setup.init()
    queue.start()
  })

  // Shutdown (SIGTERM): persist all open boards, then close the database (PLAN.md 5.3).
  app.addHook('preClose', async () => {
    clearInterval(maintenanceTimer)
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
