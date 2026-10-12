/// <reference lib="webworker" />
import { ulid } from '@wb/shared'
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { putShare, type QueuedFile, uploadPending } from './shareQueue.ts'

type SyncEvent = ExtendableEvent & { tag: string }
type SyncRegistration = ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }

const SYNC_TAG = 'upload-shares'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

// Share target (PLAN.md 5.6): store the shared data locally first (nothing is lost without
// network), then the /share page uploads it at once; background sync retries later. Registered
// before Workbox so it sees the POST first.
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
    textDone: false,
    filesDone: [],
    itemIds: [],
  })
  await (self.registration as SyncRegistration).sync?.register(SYNC_TAG).catch(() => undefined)
  return Response.redirect(new URL(`/share?id=${id}`, self.location.origin).href, 303)
}

// Background sync: upload what is still waiting once the phone is online again.
self.addEventListener('sync', (event) => {
  const sync = event as SyncEvent
  if (sync.tag !== SYNC_TAG) return
  sync.waitUntil(
    uploadPending().then((left) => {
      // Throwing makes the browser try again later.
      if (left > 0) throw new Error(`${left} shares still waiting`)
    }),
  )
})

// New versions wait until the user taps "neu laden" (PLAN.md 5.6); the page sends this message.
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting()
})

// Versions before Phase 3 had no "neu laden" prompt: if one of them is active, take over at once,
// otherwise its pages would keep the old version until every tab is closed. The marker cache tells
// whether the active worker already knows the prompt.
const PROMPT_MARKER = 'wb-update-prompt-v1'
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.has(PROMPT_MARKER).then((supported) => {
      if (self.registration.active && !supported) return self.skipWaiting()
    }),
  )
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.open(PROMPT_MARKER))
})
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/socket\.io/, /^\/healthz/, /^\/manifest\.webmanifest/, /^\/share-target/],
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
