import fs from 'node:fs'
import { type AdminUser, type OneTimeLink, ulid } from '@wb/shared'
import { and, asc, count, eq, isNull, ne } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authOf, requireAdmin } from '../auth/hook.ts'
import type { AppContext } from '../context.ts'
import { boards, invites, passwordResets, users } from '../db/schema.ts'
import { noStore, parseBody, sendError } from '../lib/http.ts'
import { randomToken, sha256 } from '../lib/tokens.ts'

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

  // Minimal system page for Phase 1; jobs, storage and backups follow in Phase 6 (PLAN.md 7.7).
  app.get('/api/admin/system', async () => {
    const userCount = db.select({ n: count() }).from(users).get()?.n ?? 0
    const boardCount = db.select({ n: count() }).from(boards).where(isNull(boards.deletedAt)).get()?.n ?? 0
    let dbBytes = 0
    for (const suffix of ['', '-wal']) {
      try {
        dbBytes += fs.statSync(ctx.database.file + suffix).size
      } catch {
        // WAL file may not exist.
      }
    }
    return { version: ctx.config.APP_VERSION, users: userCount, boards: boardCount, dbBytes }
  })
}
