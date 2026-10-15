import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Config } from '../config.ts'
import type { AppContext } from '../context.ts'
import { sendError } from '../lib/http.ts'
import { type Auth, SESSION_COOKIE, SESSION_LIFETIME_MS } from './sessions.ts'

declare module 'fastify' {
  interface FastifyRequest {
    auth: Auth | null
  }
}

// API routes that work without a session (PLAN.md 6); everything else under /api/ requires one.
const PUBLIC_API: { method: string; pattern: RegExp }[] = [
  { method: 'GET', pattern: /^\/api\/auth\/status$/ },
  { method: 'POST', pattern: /^\/api\/auth\/setup$/ },
  { method: 'POST', pattern: /^\/api\/auth\/login$/ },
  { method: 'POST', pattern: /^\/api\/auth\/logout$/ },
  { method: 'POST', pattern: /^\/api\/auth\/passkey\/(options|login)$/ },
  { method: 'POST', pattern: /^\/api\/auth\/reset\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/invites\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/invites\/[^/]+$/ },
  // Browsers send CSP violation reports without credentials.
  { method: 'POST', pattern: /^\/api\/csp-report$/ },
  // Cloudflare email worker; checks its own bearer token (PLAN.md 5.8).
  { method: 'POST', pattern: /^\/api\/ingest\/email$/ },
]

function isPublicApi(method: string, path: string) {
  return PUBLIC_API.some((route) => route.method === method && route.pattern.test(path))
}

export function setSessionCookie(reply: FastifyReply, config: Config, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.PUBLIC_URL.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_LIFETIME_MS / 1000,
  })
}

export function clearSessionCookie(reply: FastifyReply, config: Config) {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: config.PUBLIC_URL.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
  })
}

/** "Auth everywhere" (PLAN.md 8.1): resolves the session for API calls and rejects anonymous ones. */
export function registerAuthHook(app: FastifyInstance, ctx: AppContext) {
  app.decorateRequest('auth', null)
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? ''
    const isApi = path.startsWith('/api/')
    if (!isApi && path !== '/share-target') return

    const token = request.cookies[SESSION_COOKIE]
    const auth = ctx.sessions.validate(token)
    request.auth = auth
    if (auth?.renewed && token) setSessionCookie(reply, ctx.config, token)
    if (!auth && isApi && !isPublicApi(request.method, path)) return sendError(reply, 401, 'unauthorized')
  })
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.auth?.user.role === 'admin') return true
  sendError(reply, 403, 'forbidden')
  return false
}

/** The session of a request that passed the auth hook (non-public API routes only). */
export function authOf(request: FastifyRequest): Auth {
  if (!request.auth) throw new Error('route requires a session')
  return request.auth
}
