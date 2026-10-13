import { ulid } from '@wb/shared'
import { and, asc, count, desc, eq, inArray, lt, lte } from 'drizzle-orm'
import type { FastifyBaseLogger as Logger } from 'fastify'
import type { Db } from '../db/index.ts'
import { jobs } from '../db/schema.ts'

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>

export type JobDefinition = {
  handler: JobHandler
  /** Jobs of this type running at the same time. */
  concurrency: number
  /** At most one heavy job runs at a time across all types (PLAN.md 5.5). */
  heavy: boolean
  /** Called once when the last attempt failed. */
  onFailed?: (payload: Record<string, unknown>, error: string) => void
}

export type QueueOptions = { pollMs: number; backoffMs: number[] }

const DEFAULT_OPTIONS: QueueOptions = { pollMs: 1000, backoffMs: [30_000, 5 * 60_000, 30 * 60_000] }
const KEEP_FINISHED_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Job queue in SQLite, worked off inside the app process (PLAN.md 2.3.2, 5.5): retries with
 * backoff (30 s, 5 min, 30 min), concurrency per type, one heavy job at a time, running jobs go
 * back to "queued" after a restart.
 */
export class JobQueue {
  private readonly options: QueueOptions
  private readonly running = new Map<string, number>()
  private heavyRunning = 0
  private readonly active = new Set<Promise<void>>()
  private timer: NodeJS.Timeout | undefined
  private ticking = false
  private stopped = true

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly definitions: Record<string, JobDefinition>,
    options: Partial<QueueOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  enqueue(type: string, payload: Record<string, unknown>, options: { priority?: number; delayMs?: number } = {}) {
    if (!this.definitions[type]) throw new Error(`unknown job type ${type}`)
    const id = ulid()
    this.db
      .insert(jobs)
      .values({
        id,
        type,
        payloadJson: JSON.stringify(payload),
        priority: options.priority ?? 0,
        runAfter: Date.now() + (options.delayMs ?? 0),
      })
      .run()
    this.kick()
    return id
  }

  start() {
    this.stopped = false
    const reset = this.db.update(jobs).set({ status: 'queued' }).where(eq(jobs.status, 'running')).run()
    if (reset.changes > 0) this.log.info({ count: reset.changes }, 'interrupted jobs queued again')
    this.timer = setInterval(() => this.kick(), this.options.pollMs)
    this.timer.unref()
    this.kick()
  }

  /** Stops taking new jobs and waits for running ones (up to `waitMs`). */
  async stop(waitMs = 10_000) {
    this.stopped = true
    clearInterval(this.timer)
    await Promise.race([Promise.allSettled([...this.active]), new Promise((resolve) => setTimeout(resolve, waitMs))])
  }

  kick() {
    if (this.stopped || this.ticking) return
    this.ticking = true
    try {
      this.tick()
    } catch (error) {
      this.log.error({ err: error }, 'job queue tick failed')
    } finally {
      this.ticking = false
    }
  }

  private tick() {
    const due = this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, 'queued'), lte(jobs.runAfter, Date.now())))
      .orderBy(desc(jobs.priority), asc(jobs.runAfter))
      .limit(50)
      .all()
    for (const job of due) {
      const definition = this.definitions[job.type]
      if (!definition) continue
      if ((this.running.get(job.type) ?? 0) >= definition.concurrency) continue
      if (definition.heavy && this.heavyRunning > 0) continue
      const claimed = this.db
        .update(jobs)
        .set({ status: 'running', startedAt: Date.now(), attempts: job.attempts + 1 })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, 'queued')))
        .run()
      if (claimed.changes !== 1) continue
      this.running.set(job.type, (this.running.get(job.type) ?? 0) + 1)
      if (definition.heavy) this.heavyRunning += 1
      const run = this.run(job.id, job.type, job.payloadJson, job.attempts + 1, job.maxAttempts, definition).finally(
        () => {
          this.running.set(job.type, (this.running.get(job.type) ?? 1) - 1)
          if (definition.heavy) this.heavyRunning -= 1
          this.active.delete(run)
          this.kick()
        },
      )
      this.active.add(run)
    }
  }

  private async run(
    id: string,
    type: string,
    payloadJson: string,
    attempt: number,
    maxAttempts: number,
    definition: JobDefinition,
  ) {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>
    try {
      await definition.handler(payload)
      this.db.update(jobs).set({ status: 'done', finishedAt: Date.now(), lastError: null }).where(eq(jobs.id, id)).run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log.warn({ jobId: id, type, attempt, err: message }, 'job failed')
      if (attempt < maxAttempts) {
        const delay = this.options.backoffMs[attempt - 1] ?? this.options.backoffMs.at(-1) ?? 60_000
        this.db
          .update(jobs)
          .set({ status: 'queued', runAfter: Date.now() + delay, lastError: message.slice(0, 1000) })
          .where(eq(jobs.id, id))
          .run()
      } else {
        this.db
          .update(jobs)
          .set({ status: 'failed', finishedAt: Date.now(), lastError: message.slice(0, 1000) })
          .where(eq(jobs.id, id))
          .run()
        try {
          definition.onFailed?.(payload, message)
        } catch (callbackError) {
          this.log.error({ err: callbackError, jobId: id }, 'job failure callback failed')
        }
      }
    }
  }

  /** Deletes finished jobs older than a week. */
  purgeFinished(now = Date.now()) {
    this.db
      .delete(jobs)
      .where(and(inArray(jobs.status, ['done', 'failed']), lt(jobs.finishedAt, now - KEEP_FINISHED_MS)))
      .run()
  }

  /** Counts per status and the latest failures for the admin system page (PLAN.md 7.7). */
  stats() {
    const counts = { queued: 0, running: 0, failed: 0 }
    for (const row of this.db
      .select({ status: jobs.status, n: count() })
      .from(jobs)
      .where(inArray(jobs.status, ['queued', 'running', 'failed']))
      .groupBy(jobs.status)
      .all()) {
      counts[row.status as keyof typeof counts] = row.n
    }
    const failures = this.db
      .select({ id: jobs.id, type: jobs.type, lastError: jobs.lastError, finishedAt: jobs.finishedAt })
      .from(jobs)
      .where(eq(jobs.status, 'failed'))
      .orderBy(desc(jobs.finishedAt))
      .limit(20)
      .all()
    return { ...counts, failures }
  }

  /** "Erneut versuchen": failed jobs (one or all) start again with fresh attempts. */
  retryFailed(id?: string): number {
    const result = this.db
      .update(jobs)
      .set({ status: 'queued', attempts: 0, runAfter: Date.now(), finishedAt: null })
      .where(id ? and(eq(jobs.id, id), eq(jobs.status, 'failed')) : eq(jobs.status, 'failed'))
      .run()
    this.kick()
    return result.changes
  }

  /** Waits until no job is queued or running (tests). */
  async idle(timeoutMs = 10_000) {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      const open = this.db
        .select({ id: jobs.id })
        .from(jobs)
        .where(inArray(jobs.status, ['queued', 'running']))
        .all()
      if (open.length === 0 && this.active.size === 0) return
      this.kick()
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('job queue not idle')
  }
}
