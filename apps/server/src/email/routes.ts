import type { EmailSettings } from '@wb/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authOf } from '../auth/hook.ts'
import type { AppContext } from '../context.ts'
import { clientIp, noStore, parseBody, sendError } from '../lib/http.ts'
import { RateLimiter } from '../lib/rateLimit.ts'
import { safeEqual } from '../lib/tokens.ts'
import { MAX_EMAIL_BYTES } from './service.ts'

const senderSchema = z.object({ email: z.string().min(3).max(254) })

/** E-mail inbox (PLAN.md 5.8): ingest endpoint for the Cloudflare worker and own sender addresses. */
export function registerEmailRoutes(app: FastifyInstance, ctx: AppContext) {
  const { email, config } = ctx
  const ingestLimiter = new RateLimiter(120, 15 * 60 * 1000)
  const failedAuth = new RateLimiter(20, 15 * 60 * 1000)

  // Raw RFC 822 mail as sent by the worker.
  app.addContentTypeParser(
    'message/rfc822',
    { parseAs: 'buffer', bodyLimit: MAX_EMAIL_BYTES },
    (_request, body, done) => done(null, body),
  )

  app.post('/api/ingest/email', { bodyLimit: MAX_EMAIL_BYTES }, async (request, reply) => {
    noStore(reply)
    const ip = clientIp(request, config)
    const expected = config.EMAIL_INGEST_TOKEN
    if (!expected) return sendError(reply, 404, 'not_found')
    const header = request.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token || !safeEqual(token, expected)) {
      return failedAuth.take(ip) ? sendError(reply, 401, 'unauthorized') : sendError(reply, 429, 'too_many_requests')
    }
    if (!ingestLimiter.take('worker')) return sendError(reply, 429, 'too_many_requests')
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) return sendError(reply, 400, 'invalid')
    const result = await email.receive(request.body)
    if (result.status === 403) return sendError(reply, 403, 'forbidden', { reason: result.reason })
    return reply.code(202).send({ id: result.id })
  })

  app.get('/api/me/email', async (request, reply): Promise<EmailSettings> => {
    noStore(reply)
    const { user } = authOf(request)
    return {
      enabled: Boolean(config.EMAIL_INGEST_TOKEN),
      address: config.EMAIL_ADDRESS ?? null,
      senders: email.senders(user.id),
    }
  })

  app.post('/api/me/senders', async (request, reply) => {
    noStore(reply)
    const { user } = authOf(request)
    const body = parseBody(senderSchema, request.body, reply)
    if (!body) return reply
    const result = email.addSender(user.id, body.email)
    if (result === 'taken') return sendError(reply, 409, 'sender_taken')
    if (result === 'invalid') return sendError(reply, 400, 'invalid', { fields: ['email'] })
    return reply.code(201).send(email.senders(user.id))
  })

  app.delete<{ Params: { email: string } }>('/api/me/senders/:email', async (request, reply) => {
    noStore(reply)
    const { user } = authOf(request)
    if (!email.removeSender(user.id, request.params.email)) return sendError(reply, 404, 'not_found')
    return reply.code(204).send()
  })
}
