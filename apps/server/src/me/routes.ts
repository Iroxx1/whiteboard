import type { SessionInfo } from '@wb/shared'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authOf, clearSessionCookie } from '../auth/hook.ts'
import { hashPassword, PASSWORD_MAX_LENGTH, verifyPassword } from '../auth/password.ts'
import { nameSchema, passwordAccepted } from '../auth/routes.ts'
import { toMe } from '../auth/sessions.ts'
import type { AppContext } from '../context.ts'
import { users } from '../db/schema.ts'
import { noStore, parseBody, sendError } from '../lib/http.ts'

const profileSchema = z
  .object({ name: nameSchema.optional(), theme: z.enum(['system', 'light', 'dark']).optional() })
  .refine((value) => value.name !== undefined || value.theme !== undefined)

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
})

/** Own profile, password and sessions (PLAN.md 4.9, 6). */
export function registerMeRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx.database

  app.get('/api/me', async (request, reply) => {
    noStore(reply)
    return toMe(authOf(request).user)
  })

  app.put('/api/me', async (request, reply) => {
    noStore(reply)
    const { user } = authOf(request)
    const body = parseBody(profileSchema, request.body, reply)
    if (!body) return reply
    db.update(users).set(body).where(eq(users.id, user.id)).run()
    return toMe({ ...user, ...body })
  })

  app.put('/api/me/password', async (request, reply) => {
    noStore(reply)
    const { user, sessionId } = authOf(request)
    const body = parseBody(passwordChangeSchema, request.body, reply)
    if (!body) return reply
    const row = db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).get()
    if (!row || !(await verifyPassword(row.passwordHash, body.currentPassword))) {
      return sendError(reply, 400, 'wrong_password')
    }
    if (!passwordAccepted(reply, body.newPassword, [user.email, user.name])) return reply
    const passwordHash = await hashPassword(body.newPassword)
    db.update(users).set({ passwordHash }).where(eq(users.id, user.id)).run()
    // Other devices have to sign in again.
    for (const session of ctx.sessions.list(user.id)) {
      if (session.id !== sessionId) ctx.hub.disconnectSession(session.id)
    }
    ctx.sessions.revokeAll(user.id, sessionId)
    return reply.code(204).send()
  })

  app.get('/api/me/sessions', async (request, reply): Promise<SessionInfo[]> => {
    noStore(reply)
    const { user, sessionId } = authOf(request)
    return ctx.sessions
      .list(user.id)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        userAgent: session.userAgent,
        ip: session.ip,
        current: session.id === sessionId,
      }))
  })

  app.delete<{ Params: { id: string } }>('/api/me/sessions/:id', async (request, reply) => {
    noStore(reply)
    const { user, sessionId } = authOf(request)
    if (!ctx.sessions.revoke(user.id, request.params.id)) return sendError(reply, 404, 'not_found')
    ctx.hub.disconnectSession(request.params.id)
    if (request.params.id === sessionId) clearSessionCookie(reply, ctx.config)
    return reply.code(204).send()
  })
}
