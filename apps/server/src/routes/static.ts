import fs from 'node:fs'
import path from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'
import type { Config } from '../config.ts'

const NO_CACHE_FILES = new Set(['index.html', 'sw.js', 'registerSW.js'])

/** Cache rules from PLAN.md 7.4: hashed assets forever, entry points always revalidated. */
export function cacheControlFor(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+/, '')
  if (NO_CACHE_FILES.has(normalized) || normalized.endsWith('.webmanifest')) return 'no-cache'
  if (normalized.startsWith('assets/')) return 'public, max-age=31536000, immutable'
  if (normalized.startsWith('fonts/')) return 'public, max-age=2592000'
  return 'public, max-age=3600'
}

export async function registerStatic(app: FastifyInstance, config: Config) {
  const root = path.resolve(config.WEB_DIST)
  const hasWebBuild = fs.existsSync(path.join(root, 'index.html'))
  if (!hasWebBuild) app.log.warn({ root }, 'web build not found, serving API only')

  if (hasWebBuild) {
    await app.register(fastifyStatic, {
      root,
      // Serves index.html for "/"; other client routes fall through to the not-found handler below.
      index: ['index.html'],
      wildcard: true,
      setHeaders(res, filePath) {
        res.header('Cache-Control', cacheControlFor(path.relative(root, filePath)))
      },
    })
  }

  // Client-side routing: unknown GET pages get the app shell; API paths get a JSON 404.
  app.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0] ?? ''
    const wantsPage =
      (request.method === 'GET' || request.method === 'HEAD') &&
      !pathname.startsWith('/api/') &&
      !pathname.startsWith('/socket.io') &&
      (request.headers.accept ?? '').includes('text/html')
    if (hasWebBuild && wantsPage) {
      reply.header('Cache-Control', 'no-cache')
      return reply.sendFile('index.html')
    }
    return reply.code(404).send({ error: 'not found' })
  })
}
