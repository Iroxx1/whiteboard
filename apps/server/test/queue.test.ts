import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/db/index.ts'
import { jobs } from '../src/db/schema.ts'
import { JobQueue } from '../src/jobs/queue.ts'

const log = pino({ level: 'silent' })

async function database() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-queue-'))
  return openDatabase(dir, path.resolve(import.meta.dirname, '../drizzle'), log)
}

describe('JobQueue', () => {
  it('retries with backoff and reports the final failure', async () => {
    const { db } = await database()
    let calls = 0
    const failures: string[] = []
    const queue = new JobQueue(
      db,
      log,
      {
        flaky: {
          concurrency: 1,
          heavy: false,
          handler: async () => {
            calls += 1
            if (calls < 3) throw new Error(`boom ${calls}`)
          },
        },
        broken: {
          concurrency: 1,
          heavy: false,
          handler: async () => {
            throw new Error('always')
          },
          onFailed: (_payload, error) => failures.push(error),
        },
      },
      { pollMs: 5, backoffMs: [5, 5] },
    )
    queue.start()
    queue.enqueue('flaky', {})
    queue.enqueue('broken', { itemId: 'x' })
    await queue.idle()
    await queue.stop()
    expect(calls).toBe(3)
    expect(failures).toEqual(['always'])
    const rows = db.select().from(jobs).all()
    expect(rows.map((row) => [row.type, row.status, row.attempts]).sort()).toEqual([
      ['broken', 'failed', 3],
      ['flaky', 'done', 3],
    ])
  })

  it('runs at most one heavy job at a time and respects per-type concurrency', async () => {
    const { db } = await database()
    let heavyNow = 0
    let heavyMax = 0
    let lightNow = 0
    let lightMax = 0
    const wait = () => new Promise((resolve) => setTimeout(resolve, 20))
    const queue = new JobQueue(
      db,
      log,
      {
        image: {
          concurrency: 1,
          heavy: true,
          handler: async () => {
            heavyNow++
            heavyMax = Math.max(heavyMax, heavyNow)
            await wait()
            heavyNow--
          },
        },
        video: {
          concurrency: 1,
          heavy: true,
          handler: async () => {
            heavyNow++
            heavyMax = Math.max(heavyMax, heavyNow)
            await wait()
            heavyNow--
          },
        },
        link: {
          concurrency: 2,
          heavy: false,
          handler: async () => {
            lightNow++
            lightMax = Math.max(lightMax, lightNow)
            await wait()
            lightNow--
          },
        },
      },
      { pollMs: 5 },
    )
    queue.start()
    for (let i = 0; i < 3; i++) {
      queue.enqueue('image', {})
      queue.enqueue('video', {})
      queue.enqueue('link', {})
      queue.enqueue('link', {})
    }
    await queue.idle()
    await queue.stop()
    expect(heavyMax).toBe(1)
    expect(lightMax).toBe(2)
  })

  it('puts interrupted jobs back into the queue on start', async () => {
    const { db } = await database()
    db.insert(jobs).values({ id: 'j1', type: 'noop', payloadJson: '{}', status: 'running', runAfter: 0 }).run()
    let ran = false
    const queue = new JobQueue(
      db,
      log,
      {
        noop: {
          concurrency: 1,
          heavy: false,
          handler: async () => {
            ran = true
          },
        },
      },
      { pollMs: 5 },
    )
    queue.start()
    await queue.idle()
    await queue.stop()
    expect(ran).toBe(true)
  })
})
