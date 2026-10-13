import type { SearchResult } from '@wb/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../context.ts'
import { noStore, sendError } from '../lib/http.ts'

const querySchema = z.object({ q: z.string().max(200).default('') })

/** `GET /api/search?q=` (PLAN.md 5.9, 6). */
export function registerSearchRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/search', async (request, reply): Promise<SearchResult | undefined> => {
    noStore(reply)
    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) {
      sendError(reply, 400, 'invalid')
      return
    }
    return ctx.search.search(parsed.data.q, (ids) => ctx.items.byIds(ids))
  })
}
