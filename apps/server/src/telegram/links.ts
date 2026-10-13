import { randomBytes } from 'node:crypto'
import { and, eq, gt, isNull, lt } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { telegramLinkCodes, telegramLinks, users } from '../db/schema.ts'
import { sha256 } from '../lib/tokens.ts'

export const LINK_CODE_TTL_MS = 10 * 60 * 1000
export const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{24}$/

export type LinkedUser = { id: string; name: string }

/** Telegram account ↔ user links and the one-time codes of the deep link (PLAN.md 5.7). */
export class TelegramLinks {
  constructor(private readonly db: Db) {}

  /** New one-time code (10 min); older codes of the user stop working. */
  createCode(userId: string, now = Date.now()): { code: string; expiresAt: number } {
    // 18 random bytes = 24 URL-safe characters (Telegram allows up to 64 in /start).
    const code = randomBytes(18).toString('base64url')
    const expiresAt = now + LINK_CODE_TTL_MS
    this.db.transaction(() => {
      this.db.delete(telegramLinkCodes).where(eq(telegramLinkCodes.userId, userId)).run()
      this.db.delete(telegramLinkCodes).where(lt(telegramLinkCodes.expiresAt, now)).run()
      this.db
        .insert(telegramLinkCodes)
        .values({ codeHash: sha256(code), userId, expiresAt })
        .run()
    })
    return { code, expiresAt }
  }

  /** Redeems a code from `/start <code>`; returns the linked user or null. */
  redeem(code: string, telegramUserId: number, username: string | null, now = Date.now()): LinkedUser | null {
    if (!LINK_CODE_PATTERN.test(code)) return null
    return this.db.transaction(() => {
      const row = this.db
        .select({ userId: telegramLinkCodes.userId })
        .from(telegramLinkCodes)
        .where(and(eq(telegramLinkCodes.codeHash, sha256(code)), gt(telegramLinkCodes.expiresAt, now)))
        .get()
      if (!row) return null
      const user = this.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.id, row.userId), isNull(users.disabledAt)))
        .get()
      this.db
        .delete(telegramLinkCodes)
        .where(eq(telegramLinkCodes.codeHash, sha256(code)))
        .run()
      if (!user) return null
      // One Telegram account belongs to one user and vice versa.
      this.db.delete(telegramLinks).where(eq(telegramLinks.telegramUserId, telegramUserId)).run()
      this.db.delete(telegramLinks).where(eq(telegramLinks.userId, user.id)).run()
      this.db.insert(telegramLinks).values({ userId: user.id, telegramUserId, username, linkedAt: now }).run()
      return user
    })
  }

  /** The active user behind a Telegram account (disabled accounts count as unknown). */
  userFor(telegramUserId: number): LinkedUser | null {
    return (
      this.db
        .select({ id: users.id, name: users.name })
        .from(telegramLinks)
        .innerJoin(users, eq(users.id, telegramLinks.userId))
        .where(and(eq(telegramLinks.telegramUserId, telegramUserId), isNull(users.disabledAt)))
        .get() ?? null
    )
  }

  linkOf(userId: string): { username: string | null; linkedAt: number } | null {
    return (
      this.db
        .select({ username: telegramLinks.username, linkedAt: telegramLinks.linkedAt })
        .from(telegramLinks)
        .where(eq(telegramLinks.userId, userId))
        .get() ?? null
    )
  }

  unlinkUser(userId: string): boolean {
    return this.db.delete(telegramLinks).where(eq(telegramLinks.userId, userId)).run().changes > 0
  }

  unlinkTelegram(telegramUserId: number): boolean {
    return this.db.delete(telegramLinks).where(eq(telegramLinks.telegramUserId, telegramUserId)).run().changes > 0
  }
}
