import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SystemInfo } from '@wb/shared'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encodeSnapshot } from '../src/boards/snapshots.ts'
import { openDatabase } from '../src/db/index.ts'
import { assets, boardSnapshots, boards } from '../src/db/schema.ts'
import { collectBoardFiles, dailyBackup, lastBackup, pruneBackups } from '../src/ops/maintenance.ts'
import { post, setupAdmin, startApp, type TestApp } from './helpers.ts'

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle')
const DAY = 24 * 60 * 60 * 1000

// Backups and clean-up (PLAN.md 7.6).
describe('maintenance', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ops-'))

  it('writes one daily backup from 03:30 and keeps 14 days', async () => {
    const dir = tmp()
    const { sqlite } = await openDatabase(dir, MIGRATIONS, pino({ level: 'silent' }))
    expect(await dailyBackup(sqlite, dir, new Date(2026, 9, 13, 3, 0))).toBeNull()
    const file = await dailyBackup(sqlite, dir, new Date(2026, 9, 13, 3, 31))
    expect(path.basename(file ?? '')).toBe('db-2026-10-13.sqlite')
    expect(await dailyBackup(sqlite, dir, new Date(2026, 9, 13, 22, 0))).toBeNull()
    expect(lastBackup(dir)?.file).toBe('db-2026-10-13.sqlite')

    const backups = path.join(dir, 'backups')
    for (const day of ['2026-09-20', '2026-09-28', '2026-09-30'])
      fs.writeFileSync(path.join(backups, `db-${day}.sqlite`), 'x')
    for (let i = 1; i <= 7; i++) fs.writeFileSync(path.join(backups, `pre-migration-2026-10-0${i}T00.sqlite`), 'x')
    pruneBackups(dir, new Date(2026, 9, 13, 12, 0))
    const left = fs.readdirSync(backups).sort()
    expect(left.filter((name) => name.startsWith('db-'))).toEqual(['db-2026-09-30.sqlite', 'db-2026-10-13.sqlite'])
    expect(left.filter((name) => name.startsWith('pre-migration-'))).toHaveLength(5)
    sqlite.close()
  })

  it('removes board images nobody references any more', async () => {
    const dir = tmp()
    const { sqlite, db } = await openDatabase(dir, MIGRATIONS, pino({ level: 'silent' }))
    const now = Date.now()
    db.insert(boards)
      .values({
        id: 'b1',
        name: 'B',
        hashtag: 'b',
        createdAt: now,
        updatedAt: now,
        elementsJson: JSON.stringify([{ id: 'e1', type: 'image', fileId: 'on-board' }]),
      })
      .run()
    db.insert(boardSnapshots)
      .values({
        id: 's1',
        boardId: 'b1',
        createdAt: now,
        reason: 'manual',
        elementCount: 1,
        elementsGz: encodeSnapshot({
          elements: [{ id: 'e2', type: 'image', fileId: 'in-snapshot' } as never],
          appState: {},
        }),
      })
      .run()
    for (const [id, age] of [
      ['on-board', 40],
      ['in-snapshot', 40],
      ['unused-old', 40],
      ['unused-new', 5],
    ] as const) {
      const relative = `boards/b1/${id}.png`
      fs.mkdirSync(path.join(dir, 'files', 'boards', 'b1'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'files', relative), 'png')
      db.insert(assets)
        .values({
          id,
          boardId: 'b1',
          role: 'board_file',
          mime: 'image/png',
          size: 3,
          sha256: 'x',
          path: relative,
          createdAt: now - age * DAY,
        })
        .run()
    }
    expect(collectBoardFiles(db, dir, now)).toBe(1)
    expect(fs.existsSync(path.join(dir, 'files', 'boards/b1/unused-old.png'))).toBe(false)
    expect(
      db
        .select({ id: assets.id })
        .from(assets)
        .all()
        .map((row) => row.id)
        .sort(),
    ).toEqual(['in-snapshot', 'on-board', 'unused-new'])
    // Weekly: a second run right away does nothing.
    expect(collectBoardFiles(db, dir, now + (60 * DAY) / 60)).toBe(0)
    sqlite.close()
  })
})

describe('security headers and system page', () => {
  let test: TestApp
  let cookie: string

  beforeAll(async () => {
    test = await startApp()
    cookie = await setupAdmin(test)
  })

  afterAll(async () => {
    await test.app.close()
  })

  it('sends CSP and the other security headers (PLAN.md 8.4)', async () => {
    const res = await test.app.inject({ url: '/', headers: { accept: 'text/html' } })
    const csp = String(res.headers['content-security-policy'])
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'")
    expect(csp).toContain('https://www.youtube-nocookie.com')
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain("'unsafe-eval'")
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['permissions-policy']).toContain('camera=()')
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    const api = await test.app.inject({ url: '/api/auth/status' })
    expect(api.headers['content-security-policy']).toBeDefined()
  })

  it('reports storage, backups, jobs and channels; backup on demand', async () => {
    const before = (await test.app.inject({ url: '/api/admin/system', headers: { cookie } })).json<SystemInfo>()
    expect(before).toMatchObject({
      version: expect.any(String),
      users: 1,
      jobs: { queued: 0, running: 0, failed: 0, failures: [] },
      telegram: { configured: false, connected: false },
      email: { configured: false },
    })
    expect(before.storage.totalBytes).toBeGreaterThan(0)
    const backup = await post(test.app, '/api/admin/backup', {}, cookie)
    expect(backup.json()).toMatchObject({ file: expect.stringMatching(/^db-\d{4}-\d{2}-\d{2}\.sqlite$/) })
    const after = (await test.app.inject({ url: '/api/admin/system', headers: { cookie } })).json<SystemInfo>()
    expect(after.lastBackup?.file).toBe(backup.json().file)
    expect((await post(test.app, '/api/admin/jobs/retry', {}, cookie)).json()).toEqual({ retried: 0 })
  })
})
