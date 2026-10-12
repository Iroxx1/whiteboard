// IndexedDB queue for shares received by the service worker; used by the worker and the page.
import { type DBSchema, openDB } from 'idb'

export type QueuedFile = { name: string; type: string; size: number; blob: Blob }

export type QueuedShare = {
  id: string
  createdAt: number
  title: string | null
  text: string | null
  url: string | null
  files: QueuedFile[]
  status: 'pending' | 'uploaded'
  reportId?: string
}

interface ShareDb extends DBSchema {
  'share-queue': { key: string; value: QueuedShare }
}

const dbPromise = () =>
  openDB<ShareDb>('wb-share', 1, {
    upgrade(db) {
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
