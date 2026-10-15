import { randomBytes } from 'node:crypto'
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type { PasskeyInfo } from '@wb/shared'
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../context.ts'
import { passkeys, users } from '../db/schema.ts'
import { clientIp, noStore, parseBody, sendError } from '../lib/http.ts'
import { RateLimiter } from '../lib/rateLimit.ts'
import { authOf, setSessionCookie } from './hook.ts'
import { toMe } from './sessions.ts'

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const MAX_PASSKEYS = 10

/** One-time challenges in memory (single process); a restart only means "try again". */
class Challenges {
  private readonly map = new Map<string, { challenge: string; expiresAt: number }>()

  put(key: string, challenge: string) {
    const now = Date.now()
    for (const [k, v] of this.map) if (v.expiresAt < now) this.map.delete(k)
    // Bound the memory even if someone asks for challenges in a loop.
    if (this.map.size >= 2000) this.map.delete(this.map.keys().next().value as string)
    this.map.set(key, { challenge, expiresAt: now + CHALLENGE_TTL_MS })
  }

  /** Returns the challenge once; afterwards it is gone. */
  take(key: string): string | null {
    const entry = this.map.get(key)
    this.map.delete(key)
    return entry && entry.expiresAt >= Date.now() ? entry.challenge : null
  }
}

const nameSchema = z.string().trim().min(1).max(60)
// The browser's JSON responses are validated by the library; here only the envelope and size.
const responseSchema = z.record(z.string(), z.unknown())

/** Passkeys as an additional sign-in method (Phase 10, PLAN.md 5.12); the password stays as fallback. */
export function registerPasskeyRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx.database
  const challenges = new Challenges()
  const url = new URL(ctx.config.PUBLIC_URL)
  const rpID = url.hostname
  const origin = url.origin
  const loginLimiter = new RateLimiter(30, 15 * 60 * 1000)

  const infoOf = (row: typeof passkeys.$inferSelect): PasskeyInfo => ({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    synced: row.deviceType === 'multiDevice',
  })

  // --- manage own passkeys (signed in) ---------------------------------------------------------

  app.get('/api/me/passkeys', async (request, reply) => {
    noStore(reply)
    const { user } = authOf(request)
    return db
      .select()
      .from(passkeys)
      .where(eq(passkeys.userId, user.id))
      .all()
      .map(infoOf)
      .toSorted((a, b) => a.createdAt - b.createdAt)
  })

  app.post('/api/me/passkeys/options', async (request, reply) => {
    noStore(reply)
    const { user } = authOf(request)
    const existing = db.select().from(passkeys).where(eq(passkeys.userId, user.id)).all()
    if (existing.length >= MAX_PASSKEYS) return sendError(reply, 400, 'invalid')
    const options = await generateRegistrationOptions({
      rpName: ctx.config.APP_NAME,
      rpID,
      userName: user.email,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(user.id),
      excludeCredentials: existing.map((row) => ({
        id: row.id,
        transports: JSON.parse(row.transportsJson) as string[],
      })),
      // A discoverable credential lets the login page work without typing an e-mail address.
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    })
    challenges.put(`reg:${user.id}`, options.challenge)
    return options
  })

  app.post('/api/me/passkeys', async (request, reply) => {
    noStore(reply)
    const { user } = authOf(request)
    const body = parseBody(z.object({ name: nameSchema, response: responseSchema }), request.body, reply)
    if (!body) return reply
    const expectedChallenge = challenges.take(`reg:${user.id}`)
    if (!expectedChallenge) return sendError(reply, 400, 'invalid')
    try {
      const verified = await verifyRegistrationResponse({
        response: body.response as unknown as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      })
      if (!verified.verified) return sendError(reply, 400, 'invalid')
      const { credential, credentialDeviceType, credentialBackedUp } = verified.registrationInfo
      const row = {
        id: credential.id,
        userId: user.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transportsJson: JSON.stringify(credential.transports ?? []),
        name: body.name,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        createdAt: Date.now(),
        lastUsedAt: null,
      }
      db.insert(passkeys).values(row).run()
      request.log.info({ userId: user.id }, 'passkey added')
      return reply.code(201).send(infoOf(row))
    } catch (error) {
      request.log.info({ err: error }, 'passkey registration failed')
      return sendError(reply, 400, 'invalid')
    }
  })

  app.delete<{ Params: { id: string } }>('/api/me/passkeys/:id', async (request, reply) => {
    noStore(reply)
    const { user } = authOf(request)
    const result = db
      .delete(passkeys)
      .where(and(eq(passkeys.id, request.params.id), eq(passkeys.userId, user.id)))
      .run()
    if (result.changes === 0) return sendError(reply, 404, 'not_found')
    request.log.info({ userId: user.id }, 'passkey removed')
    return reply.code(204).send()
  })

  // --- sign in (public) ------------------------------------------------------------------------

  app.post('/api/auth/passkey/options', async (request, reply) => {
    noStore(reply)
    if (!loginLimiter.take(clientIp(request, ctx.config))) return sendError(reply, 429, 'too_many_requests')
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' })
    const challengeId = randomBytes(18).toString('base64url')
    challenges.put(`auth:${challengeId}`, options.challenge)
    return { challengeId, options }
  })

  app.post('/api/auth/passkey/login', async (request, reply) => {
    noStore(reply)
    if (!loginLimiter.take(clientIp(request, ctx.config))) return sendError(reply, 429, 'too_many_requests')
    const body = parseBody(
      z.object({ challengeId: z.string().min(10).max(60), response: responseSchema }),
      request.body,
      reply,
    )
    if (!body) return reply
    const response = body.response as unknown as AuthenticationResponseJSON
    const expectedChallenge = challenges.take(`auth:${body.challengeId}`)
    const credentialId = typeof response.id === 'string' ? response.id : ''
    const found = credentialId
      ? db
          .select({ key: passkeys, user: users })
          .from(passkeys)
          .innerJoin(users, eq(users.id, passkeys.userId))
          .where(and(eq(passkeys.id, credentialId), isNull(users.disabledAt)))
          .get()
      : undefined
    if (!expectedChallenge || !found) return sendError(reply, 401, 'invalid_credentials')
    try {
      const verified = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: found.key.id,
          publicKey: new Uint8Array(found.key.publicKey),
          counter: found.key.counter,
          transports: JSON.parse(found.key.transportsJson) as string[],
        } as Parameters<typeof verifyAuthenticationResponse>[0]['credential'],
      })
      if (!verified.verified) return sendError(reply, 401, 'invalid_credentials')
      db.update(passkeys)
        .set({
          counter: verified.authenticationInfo.newCounter,
          backedUp: verified.authenticationInfo.credentialBackedUp,
          lastUsedAt: Date.now(),
        })
        .where(eq(passkeys.id, found.key.id))
        .run()
    } catch (error) {
      request.log.info({ err: error }, 'passkey login failed')
      return sendError(reply, 401, 'invalid_credentials')
    }
    const token = ctx.sessions.create(found.user.id, {
      userAgent: request.headers['user-agent'],
      ip: clientIp(request, ctx.config),
    })
    setSessionCookie(reply, ctx.config, token)
    request.log.info({ userId: found.user.id }, 'signed in with passkey')
    return toMe(found.user)
  })
}
