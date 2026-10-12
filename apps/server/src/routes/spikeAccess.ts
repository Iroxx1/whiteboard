import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Config } from '../config.ts'

export const SPIKE_COOKIE = 'wb_spike'
const COOKIE_MAX_AGE_S = 180 * 24 * 60 * 60
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 10

export type SpikeAccess = {
  has: (request: FastifyRequest) => boolean
  /** Replies with 401 and returns false when the request lacks the spike cookie. */
  require: (request: FastifyRequest, reply: FastifyReply) => boolean
}

/**
 * Phase 0 stand-in for real accounts (PLAN.md 8.1 "auth everywhere"): opening
 * `/zugang?key=<SPIKE_ACCESS_KEY>` once sets a long-lived HttpOnly cookie. Replaced in Phase 1.
 */
export function registerSpikeAccess(app: FastifyInstance, config: Config): SpikeAccess {
  const key = config.SPIKE_ACCESS_KEY
  const expected = key ? createHmac('sha256', key).update('wb-spike-v1').digest('hex') : null
  const secure = config.PUBLIC_URL.startsWith('https://')
  const attempts = new Map<string, { count: number; since: number }>()

  const has = (request: FastifyRequest) => {
    // Without a key (development/test only, enforced by config) the spike endpoints are open.
    if (!expected) return config.NODE_ENV !== 'production'
    const value = request.cookies[SPIKE_COOKIE]
    if (!value || value.length !== expected.length) return false
    return timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  }

  const keyMatches = (candidate: string) => {
    if (!key) return false
    const a = createHmac('sha256', 'compare').update(candidate).digest()
    const b = createHmac('sha256', 'compare').update(key).digest()
    return timingSafeEqual(a, b)
  }

  const tooManyAttempts = (ip: string) => {
    const now = Date.now()
    const entry = attempts.get(ip)
    if (!entry || now - entry.since > ATTEMPT_WINDOW_MS) {
      attempts.set(ip, { count: 1, since: now })
      return false
    }
    entry.count += 1
    return entry.count > MAX_ATTEMPTS
  }

  app.get<{ Querystring: { key?: string } }>('/zugang', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (tooManyAttempts(request.ip)) {
      return reply.code(429).type('text/plain; charset=utf-8').send('Zu viele Versuche. Bitte später erneut.')
    }
    if (!expected || !keyMatches(request.query.key ?? '')) {
      return reply.code(403).type('text/plain; charset=utf-8').send('Zugangsschlüssel ungültig.')
    }
    attempts.delete(request.ip)
    reply.setCookie(SPIKE_COOKIE, expected, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE_S,
    })
    return reply.redirect('/', 303)
  })

  app.get('/api/debug/access', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { ok: has(request) }
  })

  return {
    has,
    require(request, reply) {
      if (has(request)) return true
      reply.code(401).send({ error: 'unauthorized' })
      return false
    },
  }
}
