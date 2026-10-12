import fs from 'node:fs'
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../context.ts'

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext) {
  // Public on purpose; reveals no details (PLAN.md 6).
  app.get('/healthz', async (_request, reply) => {
    let healthy = true
    try {
      fs.accessSync(ctx.config.DATA_DIR, fs.constants.W_OK)
      ctx.database.sqlite.prepare('SELECT 1').get()
    } catch {
      healthy = false
    }
    reply.header('Cache-Control', 'no-store')
    return reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'error' })
  })
}
