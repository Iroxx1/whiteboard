/// <reference lib="webworker" />
import { ulid } from '@wb/shared'
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { putShare, type QueuedFile } from './shareQueue.ts'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

// Share target (PLAN.md 5.6): store the shared data locally first, then let the /share page
// upload it. Registered before Workbox so it sees the POST first.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share-target') {
    event.respondWith(handleShareTarget(event.request))
  }
})

async function handleShareTarget(request: Request): Promise<Response> {
  const form = await request.formData()
  const text = (name: string) => {
    const value = form.get(name)
    return typeof value === 'string' && value !== '' ? value : null
  }
  const files: QueuedFile[] = []
  for (const entry of form.getAll('files')) {
    if (typeof entry !== 'string') files.push({ name: entry.name, type: entry.type, size: entry.size, blob: entry })
  }
  const id = ulid()
  await putShare({
    id,
    createdAt: Date.now(),
    title: text('title'),
    text: text('text'),
    url: text('url'),
    files,
    status: 'pending',
  })
  return Response.redirect(new URL(`/share?id=${id}`, self.location.origin).href, 303)
}

// Phase 0: activate new versions right away. The "new version available" prompt follows in Phase 3.
self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/zugang/, /^\/healthz/, /^\/manifest\.webmanifest/, /^\/share-target/],
  }),
)

// Hashed build chunks and fonts never change under the same URL: cache them on first use.
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')),
  new CacheFirst({
    cacheName: 'wb-runtime-assets',
    plugins: [new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 60 * 24 * 60 * 60 })],
  }),
)
