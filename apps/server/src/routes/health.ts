import fs from 'node:fs'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../config.ts'

export function registerHealthRoutes(app: FastifyInstance, config: Config) {
  // Public on purpose; reveals no details (PLAN.md 6).
  app.get('/healthz', async (_request, reply) => {
    let healthy = true
    try {
      fs.accessSync(config.DATA_DIR, fs.constants.W_OK)
    } catch {
      healthy = false
    }
    reply.header('Cache-Control', 'no-store')
    return reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'error' })
  })
}
