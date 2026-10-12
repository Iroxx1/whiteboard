import type { FastifyInstance } from 'fastify'
import type { Config } from '../config.ts'

/** Accept list for the share target; Spike A checks whether Chrome on Android honours the wildcard. */
export const SHARE_ACCEPT = ['image/*', 'video/*', 'audio/*', 'application/pdf', 'text/*', 'application/*', '*/*']

export function buildManifest(config: Config) {
  return {
    id: '/',
    name: config.APP_NAME,
    short_name: config.APP_NAME,
    lang: 'de',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f8f9fa',
    theme_color: '#1e1e24',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    share_target: {
      action: '/share-target',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [{ name: 'files', accept: SHARE_ACCEPT }],
      },
    },
  }
}

export function registerManifestRoute(app: FastifyInstance, config: Config) {
  // Served dynamically so name and colours are configurable without a rebuild (PLAN.md 5.6).
  const body = JSON.stringify(buildManifest(config))
  app.get('/manifest.webmanifest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-cache')
    reply.type('application/manifest+json; charset=utf-8')
    return body
  })
}
