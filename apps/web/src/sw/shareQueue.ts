// Shares received by the service worker wait in IndexedDB until they are uploaded (PLAN.md 5.6).
// Used by the service worker (background sync) and by the pages (immediate upload, app start).
import { type DBSchema, openDB } from 'idb'

export type QueuedFile = { name: string; type: string; size: number; blob: Blob }

export type ShareStatus = 'pending' | 'done' | 'unauthorized' | 'failed'

export type QueuedShare = {
  /** clientShareId: makes every upload step idempotent on the server. */
  id: string
  createdAt: number
  title: string | null
  text: string | null
  url: string | null
  files: QueuedFile[]
  status: ShareStatus
  textDone: boolean
  filesDone: number[]
  itemIds: string[]
  error?: string
}

interface ShareDb extends DBSchema {
  'share-queue': { key: string; value: QueuedShare }
}

const dbPromise = () =>
  openDB<ShareDb>('wb-share', 2, {
    upgrade(db, oldVersion) {
      // Version 1 (Phase 0 test page) had a different record shape; start fresh.
      if (oldVersion >= 1) db.deleteObjectStore('share-queue')
      db.createObjectStore('share-queue', { keyPath: 'id' })
    },
  })

export async function putShare(share: QueuedShare) {
  await (await dbPromise()).put('share-queue', share)
}

export async function getShare(id: string) {
  return (await dbPromise()).get('share-queue', id)
}

export async function listShares() {
  return (await dbPromise()).getAll('share-queue')
}

/** Uploaded shares are kept for a day (the /share page may be reopened), then removed. */
export async function pruneShares(now = Date.now()) {
  const db = await dbPromise()
  for (const share of await db.getAll('share-queue')) {
    if (share.status === 'done' && now - share.createdAt > 24 * 60 * 60 * 1000) await db.delete('share-queue', share.id)
  }
}

type ItemsResponse = { items: { id: string }[] }

class UploadError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

async function send(url: string, body: BodyInit, json: boolean): Promise<ItemsResponse> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: json ? { 'Content-Type': 'application/json' } : {},
    body,
  })
  if (!response.ok) throw new UploadError(response.status)
  return (await response.json()) as ItemsResponse
}

const running = new Map<string, Promise<QueuedShare>>()

/**
 * Uploads a share step by step: text/URL first, then each file in its own request (each stays
 * below Cloudflare's 100 MB limit). Progress is stored after every step, so a retry continues.
 */
export function uploadShare(id: string): Promise<QueuedShare | undefined> {
  const existing = running.get(id)
  if (existing) return existing
  const run = (async () => {
    const share = await getShare(id)
    if (!share) throw new Error('share not found')
    if (share.status === 'done' || share.status === 'failed') return share
    const ids = new Set(share.itemIds)
    try {
      if (!share.textDone) {
        const result = await send(
          '/api/items/share',
          JSON.stringify({
            clientShareId: share.id,
            title: share.title ?? undefined,
            text: share.text ?? undefined,
            url: share.url ?? undefined,
            fileCount: share.files.length,
          }),
          true,
        )
        for (const item of result.items) ids.add(item.id)
        share.textDone = true
        share.itemIds = [...ids]
        await putShare(share)
      }
      for (const [index, file] of share.files.entries()) {
        if (share.filesDone.includes(index)) continue
        const form = new FormData()
        form.set('index', String(index))
        form.set('file', file.blob, file.name)
        const result = await send(`/api/items/share/${encodeURIComponent(share.id)}/files`, form, false)
        for (const item of result.items) ids.add(item.id)
        share.filesDone = [...share.filesDone, index]
        share.itemIds = [...ids]
        await putShare(share)
      }
      share.status = 'done'
      delete share.error
    } catch (error) {
      if (error instanceof UploadError && error.status === 401) share.status = 'unauthorized'
      else if (error instanceof UploadError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        share.status = 'failed'
        share.error = error.status === 413 ? 'file_too_large' : `HTTP ${error.status}`
      } else {
        // Offline or server unreachable: stays pending for background sync / the next app start.
        share.status = 'pending'
      }
    }
    await putShare(share)
    return share
  })().finally(() => running.delete(id))
  running.set(id, run)
  return run
}

/** Uploads everything still waiting (background sync, app start). Returns how many are left. */
export async function uploadPending(): Promise<number> {
  let left = 0
  for (const share of await listShares()) {
    if (share.status !== 'pending' && share.status !== 'unauthorized') continue
    const result = await uploadShare(share.id)
    if (result && result.status !== 'done' && result.status !== 'failed') left += 1
  }
  return left
}

export async function pendingCount(): Promise<number> {
  return (await listShares()).filter((share) => share.status === 'pending' || share.status === 'unauthorized').length
}
