import { gunzipSync, gzipSync } from 'node:zlib'
import type { BoardAppState, SceneElement, SnapshotReason } from '@wb/shared'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** Automatic snapshots: when the board changed and the last snapshot is older than this (PLAN.md 5.3). */
export const SNAPSHOT_INTERVAL_MS = 30 * 60 * 1000
/** Deleted elements older than this are dropped when a snapshot is taken (PLAN.md 5.3). */
export const TOMBSTONE_TTL_MS = 7 * DAY_MS

const KEEP_ALL_MS = 48 * HOUR_MS
const KEEP_DAILY_MS = 30 * DAY_MS
const KEEP_WEEKLY_MS = 183 * DAY_MS

export type SnapshotPayload = { elements: SceneElement[]; appState: BoardAppState }

export function encodeSnapshot(payload: SnapshotPayload): Buffer {
  return gzipSync(JSON.stringify(payload))
}

export function decodeSnapshot(data: Buffer): SnapshotPayload {
  const parsed = JSON.parse(gunzipSync(data).toString('utf8')) as Partial<SnapshotPayload>
  return { elements: parsed.elements ?? [], appState: parsed.appState ?? {} }
}

/** Ids of tombstones that may be dropped: deleted and last updated more than 7 days ago. */
export function expiredTombstones(elements: Iterable<SceneElement>, now: number): string[] {
  const ids: string[] = []
  for (const element of elements) {
    if (element.isDeleted && typeof element.updated === 'number' && now - element.updated > TOMBSTONE_TTL_MS) {
      ids.push(element.id)
    }
  }
  return ids
}

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function berlinDay(ms: number): string {
  return dayFormat.format(ms)
}

/** ISO week (e.g. "2026-W41") of the Berlin calendar day. */
function berlinWeek(ms: number): string {
  const [y, m, d] = berlinDay(ms).split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d))
  const weekday = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday)
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * Retention (PLAN.md 5.3): all snapshots of the last 48 h, then the newest per day for 30 days,
 * then the newest per week for 6 months. Manual snapshots are always kept.
 */
export function snapshotsToDelete(
  snapshots: { id: string; createdAt: number; reason: SnapshotReason }[],
  now: number,
): string[] {
  const seenDays = new Set<string>()
  const seenWeeks = new Set<string>()
  const remove: string[] = []
  for (const snapshot of snapshots.toSorted((a, b) => b.createdAt - a.createdAt)) {
    if (snapshot.reason === 'manual') continue
    const age = now - snapshot.createdAt
    if (age <= KEEP_ALL_MS) continue
    if (age <= KEEP_DAILY_MS) {
      const day = berlinDay(snapshot.createdAt)
      if (seenDays.has(day)) remove.push(snapshot.id)
      else seenDays.add(day)
      continue
    }
    if (age <= KEEP_WEEKLY_MS) {
      const week = berlinWeek(snapshot.createdAt)
      if (seenWeeks.has(week)) remove.push(snapshot.id)
      else seenWeeks.add(week)
      continue
    }
    remove.push(snapshot.id)
  }
  return remove
}
