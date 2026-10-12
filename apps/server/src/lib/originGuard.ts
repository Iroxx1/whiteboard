import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Config } from '../config.ts'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Started by the operating system's share sheet: the browser sends `Sec-Fetch-Site: none`.
const OS_INITIATED_PATHS = new Set(['/share-target'])

/**
 * CSRF protection in addition to SameSite=Lax cookies (PLAN.md 5.12): every state-changing
 * request must come from our own origin.
 */
export function originGuard(config: Config) {
  const publicOrigin = new URL(config.PUBLIC_URL).origin

  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (SAFE_METHODS.has(request.method)) return

    const site = request.headers['sec-fetch-site']
    const path = request.url.split('?')[0] ?? ''
    if (site === 'same-origin') return
    if (site === 'none' && OS_INITIATED_PATHS.has(path)) return
    if (site === undefined && request.headers.origin === publicOrigin) return

    request.log.warn({ site, origin: request.headers.origin, path }, 'rejected cross-site request')
    return reply.code(403).send({ error: 'forbidden' })
  }
}
