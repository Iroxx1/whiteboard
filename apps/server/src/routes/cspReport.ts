import type { FastifyInstance } from 'fastify'
import { RateLimiter } from '../lib/rateLimit.ts'

const MAX_REPORT_BYTES = 16 * 1024

type Report = { 'csp-report'?: Record<string, unknown> }

/**
 * CSP violation reports (`report-uri`, PLAN.md 8.4): logged as directive and blocked source only,
 * so a too strict policy shows up in `docker compose logs app`.
 */
export function registerCspReportRoute(app: FastifyInstance) {
  const limiter = new RateLimiter(100, 15 * 60 * 1000)
  app.addContentTypeParser(
    ['application/csp-report', 'application/reports+json'],
    { parseAs: 'string', bodyLimit: MAX_REPORT_BYTES },
    (_request, body, done) => {
      try {
        done(null, JSON.parse(String(body)))
      } catch {
        done(null, {})
      }
    },
  )
  app.post('/api/csp-report', { bodyLimit: MAX_REPORT_BYTES }, async (request, reply) => {
    if (limiter.take(request.ip)) {
      const report = (request.body as Report | undefined)?.['csp-report'] ?? {}
      const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 200) : undefined)
      request.log.warn(
        {
          directive: text(report['effective-directive'] ?? report['violated-directive']),
          blocked: text(report['blocked-uri']),
          page: text(report['document-uri'])?.split('?')[0],
        },
        'csp violation',
      )
    }
    return reply.code(204).send()
  })
}
