import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { FastifyBaseLogger as Logger } from 'fastify'
import * as schema from './schema.ts'

export type Db = BetterSQLite3Database<typeof schema>
export type DbHandle = { sqlite: Database.Database; db: Db; file: string }

type Journal = { entries: { tag: string }[] }

function pendingMigrationCount(sqlite: Database.Database, migrationsFolder: string): number {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as Journal
  const hasTable = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get()
  if (!hasTable) return journal.entries.length
  const { applied } = sqlite.prepare('SELECT count(*) AS applied FROM __drizzle_migrations').get() as {
    applied: number
  }
  return journal.entries.length - applied
}

/**
 * Opens the database (WAL mode) and applies pending migrations. An existing database is backed up
 * first (PLAN.md 7.5), so a failed migration can be rolled back by restoring that file.
 */
export async function openDatabase(dataDir: string, migrationsFolder: string, log: Logger): Promise<DbHandle> {
  const dir = path.join(dataDir, 'db')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'whiteboard.sqlite')
  const existed = fs.existsSync(file)

  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')

  const pending = pendingMigrationCount(sqlite, migrationsFolder)
  if (pending > 0) {
    if (existed) {
      const backupDir = path.join(dataDir, 'backups')
      fs.mkdirSync(backupDir, { recursive: true })
      const target = path.join(backupDir, `pre-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`)
      await sqlite.backup(target)
      log.info({ target, pending }, 'database backed up before migration')
    }
    migrate(drizzle(sqlite), { migrationsFolder })
    log.info({ applied: pending }, 'database migrations applied')
  }

  return { sqlite, db: drizzle(sqlite, { schema }), file }
}
