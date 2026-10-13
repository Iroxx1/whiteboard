import fs from 'node:fs'
import path from 'node:path'
import { type SenderAddress, ulid } from '@wb/shared'
import { and, asc, eq, inArray, lt } from 'drizzle-orm'
import type { FastifyBaseLogger as Logger } from 'fastify'
import { type DNSResolver, dkimVerify } from 'mailauth'
import type { Db } from '../db/index.ts'
import { inboundEmails, userSenders, users } from '../db/schema.ts'
import type { IngestFile } from '../ingest/normalize.ts'
import { IngestError, type ItemService } from '../items/service.ts'
import type { JobQueue } from '../jobs/queue.ts'
import { sanitizeFilename } from '../lib/mime.ts'
import { normalizeSender, parseEmail } from './parse.ts'

export const MAX_EMAIL_BYTES = 30 * 1024 * 1024
/** Raw mails are kept this long for troubleshooting, then deleted (PLAN.md 5.8, step 2). */
const RAW_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const MAX_SENDERS = 10

export type EmailOptions = { resolver?: DNSResolver }

export type ReceiveResult = { status: 202; id: string } | { status: 403; reason: string }

/** E-mail inbox (PLAN.md 5.8): authenticity and sender checks, raw mail storage, parsing job. */
export class EmailService {
  private queue: JobQueue | undefined
  private readonly inboundDir: string

  constructor(
    private readonly db: Db,
    private readonly items: ItemService,
    private readonly log: Logger,
    dataDir: string,
    private readonly tmpDir: string,
    private readonly options: EmailOptions = {},
  ) {
    this.inboundDir = path.join(dataDir, 'inbound')
  }

  attachQueue(queue: JobQueue) {
    this.queue = queue
  }

  // --- sender addresses ---------------------------------------------------------------------

  senders(userId: string): SenderAddress[] {
    return this.db
      .select({ email: userSenders.email, createdAt: userSenders.createdAt })
      .from(userSenders)
      .where(eq(userSenders.userId, userId))
      .orderBy(asc(userSenders.createdAt))
      .all()
  }

  /** Adds an address; 'taken' if another user has it, 'invalid' for bad input or too many. */
  addSender(userId: string, email: string): 'ok' | 'taken' | 'invalid' {
    const normalized = normalizeSender(email)
    if (!normalized) return 'invalid'
    const existing = this.db
      .select({ userId: userSenders.userId })
      .from(userSenders)
      .where(eq(userSenders.emailNormalized, normalized))
      .get()
    if (existing) return existing.userId === userId ? 'ok' : 'taken'
    if (this.senders(userId).length >= MAX_SENDERS) return 'invalid'
    this.db
      .insert(userSenders)
      .values({ userId, email: email.trim(), emailNormalized: normalized, createdAt: Date.now() })
      .run()
    return 'ok'
  }

  removeSender(userId: string, email: string): boolean {
    const normalized = normalizeSender(email)
    if (!normalized) return false
    return (
      this.db
        .delete(userSenders)
        .where(and(eq(userSenders.userId, userId), eq(userSenders.emailNormalized, normalized)))
        .run().changes > 0
    )
  }

  private userForSender(address: string): string | null {
    const normalized = normalizeSender(address)
    if (!normalized) return null
    const row = this.db
      .select({ userId: userSenders.userId, disabledAt: users.disabledAt })
      .from(userSenders)
      .innerJoin(users, eq(users.id, userSenders.userId))
      .where(eq(userSenders.emailNormalized, normalized))
      .get()
    return row && row.disabledAt === null ? row.userId : null
  }

  // --- receiving ----------------------------------------------------------------------------

  /**
   * Checks a raw mail (PLAN.md 5.8, steps 2–5): a valid DKIM signature aligned with the From domain
   * and a From address on someone's allow list. Accepted mails are stored and parsed in a job.
   */
  async receive(raw: Buffer): Promise<ReceiveResult> {
    const id = ulid()
    const now = Date.now()
    const reject = (reason: string): ReceiveResult => {
      this.db.insert(inboundEmails).values({ id, receivedAt: now, size: raw.length, status: 'rejected', reason }).run()
      this.log.info({ emailId: id, reason }, 'e-mail rejected')
      return { status: 403, reason }
    }

    let verified: Awaited<ReturnType<typeof dkimVerify>>
    try {
      verified = await dkimVerify(raw, this.options.resolver ? { resolver: this.options.resolver } : {})
    } catch {
      return reject('unreadable')
    }
    // Exactly one From address (DMARC "author domain").
    const from = verified.headerFrom.length === 1 ? verified.headerFrom[0] : undefined
    if (!from) return reject('from')
    const aligned = verified.results.some((result) => result.status.result === 'pass' && result.status.aligned)
    if (!aligned) return reject('dkim')
    const userId = this.userForSender(from)
    if (!userId) return reject('sender')

    // Same mail again (worker retry): accept without a second copy.
    const messageId = /^Message-ID:\s*(<[^>\r\n]{1,500}>)/im.exec(raw.subarray(0, 64 * 1024).toString('latin1'))?.[1]
    if (messageId) {
      const seen = this.db
        .select({ id: inboundEmails.id })
        .from(inboundEmails)
        .where(
          and(
            eq(inboundEmails.messageId, messageId),
            eq(inboundEmails.userId, userId),
            inArray(inboundEmails.status, ['queued', 'done', 'empty']),
          ),
        )
        .get()
      if (seen) return { status: 202, id: seen.id }
    }

    const date = new Date(now)
    const relative = path.posix.join(
      String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      `${id}.eml`,
    )
    const file = path.join(this.inboundDir, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, raw)
    this.db
      .insert(inboundEmails)
      .values({
        id,
        receivedAt: now,
        userId,
        messageId: messageId ?? null,
        path: relative,
        size: raw.length,
        status: 'queued',
      })
      .run()
    this.queue?.enqueue('ingest_email', { emailId: id })
    this.log.info({ emailId: id }, 'e-mail accepted')
    return { status: 202, id }
  }

  /** Job `ingest_email`: subject → title, body → note/links, attachments → files (PLAN.md 5.8). */
  async process(emailId: string) {
    const row = this.db.select().from(inboundEmails).where(eq(inboundEmails.id, emailId)).get()
    if (!row?.path || !row.userId || row.status !== 'queued') return
    const parsed = await parseEmail(fs.readFileSync(path.join(this.inboundDir, row.path)))
    const files: IngestFile[] = []
    try {
      for (const attachment of parsed.attachments) {
        const tmpPath = path.join(this.tmpDir, `${ulid()}.mail`)
        fs.writeFileSync(tmpPath, attachment.content)
        files.push({
          filename: sanitizeFilename(attachment.filename || 'anhang'),
          mime: attachment.contentType,
          size: attachment.content.length,
          tmpPath,
        })
      }
      const result = await this.items.ingest({
        userId: row.userId,
        source: 'email',
        title: parsed.title,
        text: parsed.text,
        files,
        groupKey: parsed.messageId ?? undefined,
      })
      this.finish(
        emailId,
        'done',
        result.items.map((item) => item.id),
      )
    } catch (error) {
      for (const file of files) fs.rmSync(file.tmpPath, { force: true })
      if (error instanceof IngestError) {
        this.finish(emailId, 'empty', [])
        return
      }
      throw error
    }
  }

  failed(emailId: string, error: string) {
    this.db
      .update(inboundEmails)
      .set({ status: 'failed', reason: error.slice(0, 300) })
      .where(eq(inboundEmails.id, emailId))
      .run()
  }

  private finish(emailId: string, status: 'done' | 'empty', itemIds: string[]) {
    this.db
      .update(inboundEmails)
      .set({ status, itemIds: JSON.stringify(itemIds) })
      .where(eq(inboundEmails.id, emailId))
      .run()
  }

  /** Raw mails older than 30 days and old rejection records are deleted. */
  purgeOld(now = Date.now()) {
    const old = this.db
      .select({ id: inboundEmails.id, path: inboundEmails.path })
      .from(inboundEmails)
      .where(lt(inboundEmails.receivedAt, now - RAW_RETENTION_MS))
      .all()
    for (const row of old) if (row.path) fs.rmSync(path.join(this.inboundDir, row.path), { force: true })
    if (old.length > 0) {
      this.db
        .delete(inboundEmails)
        .where(lt(inboundEmails.receivedAt, now - RAW_RETENTION_MS))
        .run()
    }
    return old.length
  }
}
