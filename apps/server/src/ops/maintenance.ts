import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import type Database from 'better-sqlite3'
import { and, eq, inArray, lt } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { assets, boardSnapshots, boards } from '../db/schema.ts'

const DAY_MS = 24 * 60 * 60 * 1000
/** Daily DB copies are kept 14 days (PLAN.md 7.6). */
export const BACKUP_KEEP_DAYS = 14
/** Copies made before migrations: the newest ones stay. */
const KEEP_PRE_MIGRATION = 5
/** The daily backup runs from 03:30 local time (TZ), or later the same day after downtime. */
const BACKUP_AFTER_MINUTES = 3 * 60 + 30
/** Unreferenced board images are removed once they are older than this (PLAN.md 7.6). */
const GC_MIN_AGE_MS = 30 * DAY_MS
const GC_INTERVAL_MS = 7 * DAY_MS
/** Admins see a warning below this share of free space (PLAN.md 7.7). */
export const STORAGE_WARN_FREE = 0.15
/** /healthz fails below this (PLAN.md 7.7). */
export const STORAGE_FAIL_FREE = 0.1

const BACKUP_NAME = /^db-(\d{4}-\d{2}-\d{2})\.sqlite$/

function localDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function backupDir(dataDir: string) {
  return path.join(dataDir, 'backups')
}

/**
 * Daily consistent copy of the database (`backup_db`, PLAN.md 7.6): `/data/backups/db-YYYY-MM-DD.sqlite`.
 * Returns the file when a backup was made, null when today's copy exists or it is too early.
 */
export async function dailyBackup(
  sqlite: Database.Database,
  dataDir: string,
  now = new Date(),
  force = false,
): Promise<string | null> {
  if (!force && now.getHours() * 60 + now.getMinutes() < BACKUP_AFTER_MINUTES) return null
  const dir = backupDir(dataDir)
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, `db-${localDate(now)}.sqlite`)
  if (!force && fs.existsSync(target)) return null
  const partial = `${target}.partial`
  await sqlite.backup(partial)
  fs.renameSync(partial, target)
  pruneBackups(dataDir, now)
  return target
}

/** Removes daily copies older than 14 days and all but the newest pre-migration copies. */
export function pruneBackups(dataDir: string, now = new Date()) {
  const dir = backupDir(dataDir)
  if (!fs.existsSync(dir)) return
  const oldest = localDate(new Date(now.getTime() - BACKUP_KEEP_DAYS * DAY_MS))
  const files = fs.readdirSync(dir)
  for (const name of files) {
    const day = BACKUP_NAME.exec(name)?.[1]
    if (day && day < oldest) fs.rmSync(path.join(dir, name), { force: true })
    if (name.endsWith('.partial')) fs.rmSync(path.join(dir, name), { force: true })
  }
  const preMigration = files.filter((name) => name.startsWith('pre-migration-')).sort()
  for (const name of preMigration.slice(0, -KEEP_PRE_MIGRATION)) fs.rmSync(path.join(dir, name), { force: true })
}

/** Newest daily backup, for the admin system page. */
export function lastBackup(dataDir: string): { file: string; at: number; bytes: number } | null {
  const dir = backupDir(dataDir)
  if (!fs.existsSync(dir)) return null
  const newest = fs
    .readdirSync(dir)
    .filter((name) => BACKUP_NAME.test(name))
    .sort()
    .at(-1)
  if (!newest) return null
  const stat = fs.statSync(path.join(dir, newest))
  return { file: newest, at: stat.mtimeMs, bytes: stat.size }
}

/** Excalidraw file ids used by image elements (also deleted ones: they can come back via undo). */
function fileIdsOf(elements: unknown, into: Set<string>) {
  if (!Array.isArray(elements)) return
  for (const element of elements as { fileId?: unknown }[]) {
    if (typeof element?.fileId === 'string') into.add(element.fileId)
  }
}

/**
 * `gc_files` (PLAN.md 7.6): board images that no board and no snapshot references any more and
 * that are older than 30 days are deleted. Runs at most weekly (marker file in the backups folder).
 */
export function collectBoardFiles(db: Db, dataDir: string, now = Date.now(), force = false): number {
  const marker = path.join(backupDir(dataDir), '.gc-files')
  if (!force && fs.existsSync(marker) && now - fs.statSync(marker).mtimeMs < GC_INTERVAL_MS) return 0
  const candidates = db
    .select({ id: assets.id, path: assets.path })
    .from(assets)
    .where(and(eq(assets.role, 'board_file'), lt(assets.createdAt, now - GC_MIN_AGE_MS)))
    .all()
  let removed = 0
  if (candidates.length > 0) {
    const used = new Set<string>()
    for (const board of db.select({ elementsJson: boards.elementsJson }).from(boards).all()) {
      fileIdsOf(JSON.parse(board.elementsJson), used)
    }
    for (const snapshot of db.select({ data: boardSnapshots.elementsGz }).from(boardSnapshots).all()) {
      fileIdsOf((JSON.parse(gunzipSync(snapshot.data).toString('utf8')) as { elements?: unknown }).elements, used)
    }
    const unused = candidates.filter((asset) => !used.has(asset.id))
    for (const asset of unused) fs.rmSync(path.join(dataDir, 'files', asset.path), { force: true })
    if (unused.length > 0) {
      db.delete(assets)
        .where(
          inArray(
            assets.id,
            unused.map((asset) => asset.id),
          ),
        )
        .run()
    }
    removed = unused.length
  }
  fs.mkdirSync(path.dirname(marker), { recursive: true })
  fs.writeFileSync(marker, new Date(now).toISOString())
  return removed
}

/** Free and total bytes of the file system holding DATA_DIR. */
export function storage(dataDir: string): { freeBytes: number; totalBytes: number; freeShare: number } {
  const stat = fs.statfsSync(dataDir)
  const totalBytes = stat.blocks * stat.bsize
  const freeBytes = stat.bavail * stat.bsize
  return { freeBytes, totalBytes, freeShare: totalBytes > 0 ? freeBytes / totalBytes : 1 }
}

/** Preview images (Phase 10) of boards that no longer exist (purged from the trash) are deleted. */
export function pruneThumbnails(db: Db, dataDir: string): number {
  const dir = path.join(dataDir, 'thumbs')
  if (!fs.existsSync(dir)) return 0
  const known = new Set(
    db
      .select({ id: boards.id })
      .from(boards)
      .all()
      .map((board) => board.id),
  )
  let removed = 0
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.webp') && !known.has(name.slice(0, -5))) {
      fs.rmSync(path.join(dir, name), { force: true })
      removed += 1
    }
  }
  return removed
}
