import { count } from 'drizzle-orm'
import type { FastifyBaseLogger as Logger } from 'fastify'
import type { Db } from '../db/index.ts'
import { users } from '../db/schema.ts'
import { randomToken, safeEqual, sha256 } from '../lib/tokens.ts'

/**
 * First start (PLAN.md 5.12): while there are no accounts, a one-time link `/setup?token=…` is
 * written to the log. The token lives in memory only; after a restart a new link is logged.
 */
export class SetupToken {
  private tokenHash: string | null = null

  constructor(
    private readonly db: Db,
    private readonly publicUrl: string,
    private readonly log: Logger,
  ) {}

  required(): boolean {
    const row = this.db.select({ n: count() }).from(users).get()
    return (row?.n ?? 0) === 0
  }

  /** Creates and logs the link if no account exists yet. */
  init() {
    if (!this.required()) return
    const token = randomToken()
    this.tokenHash = sha256(token)
    this.log.warn(
      { setupUrl: `${this.publicUrl}/setup?token=${token}` },
      'No accounts yet: open this one-time link to create the admin account',
    )
  }

  matches(token: string): boolean {
    return this.tokenHash !== null && safeEqual(sha256(token), this.tokenHash)
  }

  consume() {
    this.tokenHash = null
  }
}
