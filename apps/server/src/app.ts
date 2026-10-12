import fs from 'node:fs'
import path from 'node:path'
import fastifyCookie from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Config } from './config.ts'
import { originGuard } from './lib/originGuard.ts'
import { registerDebugShareRoutes } from './routes/debugShare.ts'
import { registerHealthRoutes } from './routes/health.ts'
import { registerManifestRoute } from './routes/manifest.ts'
import { registerSpikeAccess } from './routes/spikeAccess.ts'
import { registerStatic } from './routes/static.ts'

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      serializers: {
        // Never log query strings: they may carry access keys or tokens (PLAN.md 8.7).
        req: (request) => ({
          method: request.method,
          url: request.url.split('?')[0],
          remoteAddress: request.ip,
        }),
      },
      ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    trustProxy: config.TRUSTED_PROXIES.length > 0 ? config.TRUSTED_PROXIES : false,
    bodyLimit: 1024 * 1024,
  })

  fs.mkdirSync(path.join(config.DATA_DIR, 'tmp'), { recursive: true })

  await app.register(fastifyCookie)
  await app.register(fastifyMultipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 50, fields: 20, fieldSize: 64 * 1024 },
  })

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  })
  app.addHook('onRequest', originGuard(config))

  registerHealthRoutes(app, config)
  registerManifestRoute(app, config)
  const access = registerSpikeAccess(app, config)
  registerDebugShareRoutes(app, config, access)
  await registerStatic(app, config)

  return app
}
