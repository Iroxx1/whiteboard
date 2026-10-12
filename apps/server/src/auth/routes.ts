import { type AuthStatus, type InviteInfo, ulid } from '@wb/shared'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../context.ts'
import { invites, passwordResets, users } from '../db/schema.ts'
import { clientIp, noStore, parseBody, sendError } from '../lib/http.ts'
import { LoginThrottle, RateLimiter } from '../lib/rateLimit.ts'
import { sha256, TOKEN_PATTERN } from '../lib/tokens.ts'
import { authOf, clearSessionCookie, setSessionCookie } from './hook.ts'
import { checkPassword, hashPassword, PASSWORD_MAX_LENGTH, verifyDummy, verifyPassword } from './password.ts'
import { type SessionUser, toMe } from './sessions.ts'

export const emailSchema = z.string().trim().toLowerCase().max(200).pipe(z.email())
export const nameSchema = z.string().trim().min(1).max(60)
const passwordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH)

const accountSchema = z.object({ name: nameSchema, email: emailSchema, password: passwordSchema })
const tokenParams = z.object({ token: z.string().regex(TOKEN_PATTERN) })

/** Sends 400 `weak_password` and returns false if the password violates the policy. */
export function passwordAccepted(reply: FastifyReply, password: string, context: string[]): boolean {
  const problem = checkPassword(password, context)
  if (!problem) return true
  sendError(reply, 400, 'weak_password', { reason: problem })
  return false
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx.database
  const loginThrottle = new LoginThrottle()
  // Token links are 32 random bytes; this only stops noisy guessing.
  const tokenLimiter = new RateLimiter(30, 15 * 60 * 1000)

  const startSession = (request: FastifyRequest, reply: FastifyReply, user: SessionUser) => {
    const token = ctx.sessions.create(user.id, {
      userAgent: request.headers['user-agent'],
      ip: clientIp(request, ctx.config),
    })
    setSessionCookie(reply, ctx.config, token)
    return toMe(user)
  }

  const limitTokens = (request: FastifyRequest, reply: FastifyReply) => {
    if (tokenLimiter.take(clientIp(request, ctx.config))) return true
    sendError(reply, 429, 'too_many_requests')
    return false
  }

  app.get('/api/auth/status', async (_request, reply): Promise<AuthStatus> => {
    noStore(reply)
    return { setupRequired: ctx.setup.required() }
  })

  app.post('/api/auth/setup', async (request, reply) => {
    noStore(reply)
    if (!limitTokens(request, reply)) return reply
    const body = parseBody(accountSchema.extend({ token: z.string().max(100) }), request.body, reply)
    if (!body) return reply
    if (!ctx.setup.required() || !ctx.setup.matches(body.token)) return sendError(reply, 403, 'invalid_token')
    if (!passwordAccepted(reply, body.password, [body.email, body.name])) return reply

    const passwordHash = await hashPassword(body.password)
    const user: SessionUser = { id: ulid(), email: body.email, name: body.name, role: 'admin', theme: 'system' }
    const created = db.transaction(() => {
      // Re-check inside the transaction: only the very first account may be created this way.
      if (!ctx.setup.required()) return false
      db.insert(users)
        .values({ ...user, passwordHash, createdAt: Date.now() })
        .run()
      return true
    })
    if (!created) return sendError(reply, 403, 'invalid_token')
    ctx.setup.consume()
    request.log.info({ userId: user.id }, 'admin account created')
    return startSession(request, reply, user)
  })

  app.post('/api/auth/login', async (request, reply) => {
    noStore(reply)
    const body = parseBody(
      z.object({ email: z.string().trim().toLowerCase().max(200), password: passwordSchema }),
      request.body,
      reply,
    )
    if (!body) return reply
    const key = `${clientIp(request, ctx.config)}|${body.email}`
    const wait = loginThrottle.retryAfter(key)
    if (wait > 0) return sendError(reply, 429, 'too_many_requests', { retryAfterSeconds: Math.ceil(wait / 1000) })

    const row = db
      .select()
      .from(users)
      .where(and(eq(users.email, body.email), isNull(users.disabledAt)))
      .get()
    let valid = false
    if (row) valid = await verifyPassword(row.passwordHash, body.password)
    else await verifyDummy(body.password)
    if (!row || !valid) {
      loginThrottle.fail(key)
      return sendError(reply, 401, 'invalid_credentials')
    }
    loginThrottle.succeed(key)
    return startSession(request, reply, row)
  })

  app.post('/api/auth/logout', async (request, reply) => {
    noStore(reply)
    if (request.auth) {
      ctx.sessions.revoke(request.auth.user.id, request.auth.sessionId)
      ctx.hub.disconnectSession(request.auth.sessionId)
    }
    clearSessionCookie(reply, ctx.config)
    return reply.code(204).send()
  })

  app.get('/api/auth/me', async (request, reply) => {
    noStore(reply)
    return toMe(authOf(request).user)
  })

  const findInvite = (token: string) =>
    db
      .select()
      .from(invites)
      .where(and(eq(invites.tokenHash, sha256(token)), isNull(invites.usedAt), gt(invites.expiresAt, Date.now())))
      .get()

  app.get('/api/invites/:token', async (request, reply) => {
    noStore(reply)
    if (!limitTokens(request, reply)) return reply
    const params = tokenParams.safeParse(request.params)
    const invite = params.success ? findInvite(params.data.token) : undefined
    if (!invite) return sendError(reply, 404, 'invalid_token')
    return { role: invite.role, expiresAt: invite.expiresAt } satisfies InviteInfo
  })

  app.post('/api/invites/:token', async (request, reply) => {
    noStore(reply)
    if (!limitTokens(request, reply)) return reply
    const params = tokenParams.safeParse(request.params)
    const body = parseBody(accountSchema, request.body, reply)
    if (!body) return reply
    const invite = params.success ? findInvite(params.data.token) : undefined
    if (!invite) return sendError(reply, 404, 'invalid_token')
    if (db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).get()) {
      return sendError(reply, 409, 'email_taken')
    }
    if (!passwordAccepted(reply, body.password, [body.email, body.name])) return reply

    const passwordHash = await hashPassword(body.password)
    const user: SessionUser = { id: ulid(), email: body.email, name: body.name, role: invite.role, theme: 'system' }
    const now = Date.now()
    const outcome = db.transaction(() => {
      if (db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).get()) return 'email_taken'
      db.insert(users)
        .values({ ...user, passwordHash, createdAt: now })
        .run()
      const claimed = db
        .update(invites)
        .set({ usedAt: now, usedBy: user.id })
        .where(and(eq(invites.id, invite.id), isNull(invites.usedAt)))
        .run()
      if (claimed.changes !== 1) {
        db.delete(users).where(eq(users.id, user.id)).run()
        return 'invalid_token'
      }
      return 'ok'
    })
    if (outcome === 'email_taken') return sendError(reply, 409, 'email_taken')
    if (outcome === 'invalid_token') return sendError(reply, 404, 'invalid_token')
    request.log.info({ userId: user.id, inviteId: invite.id }, 'invite accepted')
    return startSession(request, reply, user)
  })

  app.post('/api/auth/reset/:token', async (request, reply) => {
    noStore(reply)
    if (!limitTokens(request, reply)) return reply
    const params = tokenParams.safeParse(request.params)
    const body = parseBody(z.object({ password: passwordSchema }), request.body, reply)
    if (!body) return reply
    const now = Date.now()
    const reset = params.success
      ? db
          .select({ tokenHash: passwordResets.tokenHash, user: users })
          .from(passwordResets)
          .innerJoin(users, eq(users.id, passwordResets.userId))
          .where(
            and(
              eq(passwordResets.tokenHash, sha256(params.data.token)),
              isNull(passwordResets.usedAt),
              gt(passwordResets.expiresAt, now),
              isNull(users.disabledAt),
            ),
          )
          .get()
      : undefined
    if (!reset) return sendError(reply, 404, 'invalid_token')
    if (!passwordAccepted(reply, body.password, [reset.user.email, reset.user.name])) return reply

    const passwordHash = await hashPassword(body.password)
    const done = db.transaction(() => {
      const claimed = db
        .update(passwordResets)
        .set({ usedAt: now })
        .where(and(eq(passwordResets.tokenHash, reset.tokenHash), isNull(passwordResets.usedAt)))
        .run()
      if (claimed.changes !== 1) return false
      db.update(users).set({ passwordHash }).where(eq(users.id, reset.user.id)).run()
      ctx.sessions.revokeAll(reset.user.id)
      return true
    })
    if (!done) return sendError(reply, 404, 'invalid_token')
    ctx.hub.disconnectUser(reset.user.id)
    request.log.info({ userId: reset.user.id }, 'password reset via link')
    return startSession(request, reply, reset.user)
  })
}
