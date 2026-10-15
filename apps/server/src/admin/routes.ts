import fs from 'node:fs'
import path from 'node:path'
import { type AdminUser, type OneTimeLink, type SystemInfo, ulid } from '@wb/shared'
import { and, asc, count, eq, gt, isNull, ne, sum } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authOf, requireAdmin } from '../auth/hook.ts'
import type { AppContext } from '../context.ts'
import { assets, boards, inboundEmails, invites, items, passwordResets, users } from '../db/schema.ts'
import { noStore, parseBody, sendError } from '../lib/http.ts'
import { randomToken, sha256 } from '../lib/tokens.ts'
import { dailyBackup, lastBackup, STORAGE_WARN_FREE, storage } from '../ops/maintenance.ts'
import { whisperReachable } from '../processors/transcribe.ts'

const DAY_MS = 24 * 60 * 60 * 1000
export const INVITE_LIFETIME_MS = 7 * DAY_MS
export const RESET_LIFETIME_MS = DAY_MS

const roleSchema = z.enum(['admin', 'member'])
const patchSchema = z
  .object({ disabled: z.boolean().optional(), role: roleSchema.optional() })
  .refine((value) => value.disabled !== undefined || value.role !== undefined)

/** User management (PLAN.md 4.9): invite, disable, reset links. Admins only. */
export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx.database

  const toAdminUser = (row: typeof users.$inferSelect): AdminUser => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.createdAt,
    disabledAt: row.disabledAt,
  })

  app.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/api/admin/')) {
      noStore(reply)
      if (!requireAdmin(request, reply)) return reply
    }
  })

  app.get('/api/admin/users', async () => db.select().from(users).orderBy(asc(users.name)).all().map(toAdminUser))

  app.post('/api/admin/invites', async (request, reply): Promise<OneTimeLink | undefined> => {
    const body = parseBody(z.object({ role: roleSchema.default('member') }), request.body ?? {}, reply)
    if (!body) return
    const token = randomToken()
    const now = Date.now()
    const expiresAt = now + INVITE_LIFETIME_MS
    db.insert(invites)
      .values({
        id: ulid(),
        tokenHash: sha256(token),
        role: body.role,
        createdBy: authOf(request).user.id,
        createdAt: now,
        expiresAt,
      })
      .run()
    return { url: `${ctx.config.PUBLIC_URL}/invite/${token}`, expiresAt }
  })

  app.patch<{ Params: { id: string } }>('/api/admin/users/:id', async (request, reply) => {
    const body = parseBody(patchSchema, request.body, reply)
    if (!body) return reply
    const target = db.select().from(users).where(eq(users.id, request.params.id)).get()
    if (!target) return sendError(reply, 404, 'not_found')
    if (target.id === authOf(request).user.id) return sendError(reply, 403, 'forbidden')

    const losesAdmin =
      target.role === 'admin' && !target.disabledAt && (body.disabled === true || body.role === 'member')
    if (losesAdmin) {
      const others = db
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.role, 'admin'), isNull(users.disabledAt), ne(users.id, target.id)))
        .get()
      if ((others?.n ?? 0) === 0) return sendError(reply, 409, 'last_admin')
    }

    const disabledAt = body.disabled === undefined ? target.disabledAt : body.disabled ? Date.now() : null
    db.update(users)
      .set({ disabledAt, ...(body.role ? { role: body.role } : {}) })
      .where(eq(users.id, target.id))
      .run()
    if (body.disabled) {
      ctx.sessions.revokeAll(target.id)
      ctx.hub.disconnectUser(target.id)
    }
    request.log.info({ userId: target.id, change: body }, 'user updated by admin')
    return toAdminUser({ ...target, disabledAt, role: body.role ?? target.role })
  })

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/reset-link', async (request, reply) => {
    const target = db.select({ id: users.id }).from(users).where(eq(users.id, request.params.id)).get()
    if (!target) return sendError(reply, 404, 'not_found')
    const token = randomToken()
    const now = Date.now()
    const expiresAt = now + RESET_LIFETIME_MS
    db.transaction(() => {
      // Only the newest link is valid.
      db.delete(passwordResets)
        .where(and(eq(passwordResets.userId, target.id), isNull(passwordResets.usedAt)))
        .run()
      db.insert(passwordResets)
        .values({
          tokenHash: sha256(token),
          userId: target.id,
          createdBy: authOf(request).user.id,
          createdAt: now,
          expiresAt,
        })
        .run()
    })
    return { url: `${ctx.config.PUBLIC_URL}/reset/${token}`, expiresAt } satisfies OneTimeLink
  })

  // System page (PLAN.md 7.7): version, storage, backups, jobs, Telegram and e-mail status.
  app.get('/api/admin/system', async (): Promise<SystemInfo> => {
    const userCount = db.select({ n: count() }).from(users).get()?.n ?? 0
    const boardCount = db.select({ n: count() }).from(boards).where(isNull(boards.deletedAt)).get()?.n ?? 0
    const itemCount = db.select({ n: count() }).from(items).where(ne(items.status, 'trashed')).get()?.n ?? 0
    let dbBytes = 0
    for (const suffix of ['', '-wal']) {
      try {
        dbBytes += fs.statSync(ctx.database.file + suffix).size
      } catch {
        // WAL file may not exist.
      }
    }
    const filesBytes =
      db
        .select({ n: sum(assets.size) })
        .from(assets)
        .get()?.n ?? 0
    const space = storage(ctx.config.DATA_DIR)
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const mails = { done: 0, empty: 0, queued: 0, failed: 0, rejected: 0 }
    for (const row of db
      .select({ status: inboundEmails.status, n: count() })
      .from(inboundEmails)
      .where(gt(inboundEmails.receivedAt, weekAgo))
      .groupBy(inboundEmails.status)
      .all()) {
      mails[row.status] = row.n
    }
    return {
      version: ctx.config.APP_VERSION,
      users: userCount,
      boards: boardCount,
      items: itemCount,
      dbBytes,
      filesBytes: Number(filesBytes),
      storage: { ...space, warning: space.freeShare < STORAGE_WARN_FREE },
      lastBackup: lastBackup(ctx.config.DATA_DIR),
      jobs: ctx.queue.stats(),
      telegram: {
        configured: Boolean(ctx.config.TELEGRAM_BOT_TOKEN),
        connected: ctx.telegram.enabled,
        polling: ctx.telegram.isRunning,
        username: ctx.telegram.username,
      },
      whisper: {
        enabled: ctx.config.TRANSCRIBE_ENABLED,
        reachable: ctx.config.TRANSCRIBE_ENABLED && (await whisperReachable(ctx.config.WHISPER_URL)),
        model: ctx.config.WHISPER_MODEL,
      },
      email: {
        configured: Boolean(ctx.config.EMAIL_INGEST_TOKEN),
        address: ctx.config.EMAIL_ADDRESS ?? null,
        accepted7d: mails.done + mails.empty + mails.queued,
        rejected7d: mails.rejected,
        failed7d: mails.failed,
      },
    }
  })

  // "Erneut versuchen" for failed jobs: one by id or all.
  app.post('/api/admin/jobs/retry', async (request, reply) => {
    const body = parseBody(z.object({ id: z.string().max(40).optional() }), request.body ?? {}, reply)
    if (!body) return reply
    return { retried: ctx.queue.retryFailed(body.id) }
  })

  // Backup now (e.g. before a risky change); same file as the daily one, replaced if it exists.
  app.post('/api/admin/backup', async () => {
    const file = await dailyBackup(ctx.database.sqlite, ctx.config.DATA_DIR, new Date(), true)
    return { file: file ? path.basename(file) : null, lastBackup: lastBackup(ctx.config.DATA_DIR) }
  })
}
