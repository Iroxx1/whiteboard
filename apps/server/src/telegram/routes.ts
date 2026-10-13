import type { TelegramLinkCode, TelegramStatus } from '@wb/shared'
import type { FastifyInstance } from 'fastify'
import { authOf } from '../auth/hook.ts'
import type { AppContext } from '../context.ts'
import { noStore, sendError } from '../lib/http.ts'
import { RateLimiter } from '../lib/rateLimit.ts'

/** Settings → "Telegram verbinden" (PLAN.md 5.7, 6). */
export function registerTelegramRoutes(app: FastifyInstance, ctx: AppContext) {
  const { telegram } = ctx
  const limiter = new RateLimiter(20, 15 * 60 * 1000)

  app.get('/api/me/telegram', async (request, reply): Promise<TelegramStatus> => {
    noStore(reply)
    const { user } = authOf(request)
    return { enabled: telegram.enabled, botUsername: telegram.username, linked: telegram.links.linkOf(user.id) }
  })

  app.post('/api/me/telegram/link-code', async (request, reply) => {
    noStore(reply)
    const { user } = authOf(request)
    if (!limiter.take(user.id)) return sendError(reply, 429, 'too_many_requests')
    const username = telegram.username
    if (!username) return sendError(reply, 503, 'telegram_unavailable')
    const { code, expiresAt } = telegram.links.createCode(user.id)
    return reply.code(201).send({ url: `https://t.me/${username}?start=${code}`, expiresAt } satisfies TelegramLinkCode)
  })

  app.delete('/api/me/telegram', async (request, reply) => {
    noStore(reply)
    const { user } = authOf(request)
    telegram.links.unlinkUser(user.id)
    return reply.code(204).send()
  })
}
