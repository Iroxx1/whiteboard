import type { Me, Role, ThemePreference } from '@wb/shared'
import { and, eq, gt, isNull, lt, ne } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { sessions, users } from '../db/schema.ts'
import { randomToken, sha256 } from '../lib/tokens.ts'

export const SESSION_COOKIE = 'wb_session'
const DAY_MS = 24 * 60 * 60 * 1000
export const SESSION_LIFETIME_MS = 180 * DAY_MS
const RENEW_AFTER_MS = DAY_MS
const LAST_SEEN_RESOLUTION_MS = 10 * 60 * 1000

export type SessionUser = {
  id: string
  email: string
  name: string
  role: Role
  theme: ThemePreference
}

export type Auth = {
  sessionId: string
  user: SessionUser
  /** Set when the session was extended; the caller refreshes the cookie with this token. */
  renewed: boolean
}

export function toMe(user: SessionUser): Me {
  return { id: user.id, email: user.email, name: user.name, role: user.role, theme: user.theme }
}

/** Sessions (PLAN.md 5.12): 32-byte token in the cookie, only its SHA-256 in the database. */
export class Sessions {
  constructor(private readonly db: Db) {}

  create(userId: string, meta: { userAgent?: string | undefined; ip?: string | undefined }, now = Date.now()) {
    const token = randomToken()
    this.db
      .insert(sessions)
      .values({
        id: sha256(token),
        userId,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now + SESSION_LIFETIME_MS,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        ip: meta.ip ?? null,
      })
      .run()
    return token
  }

  /** Validates a cookie token; slides the expiry when the last renewal is more than 24 h ago. */
  validate(token: string | undefined, now = Date.now()): Auth | null {
    if (!token || token.length > 100) return null
    const id = sha256(token)
    const row = this.db
      .select({
        expiresAt: sessions.expiresAt,
        lastSeenAt: sessions.lastSeenAt,
        user: { id: users.id, email: users.email, name: users.name, role: users.role, theme: users.theme },
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now), isNull(users.disabledAt)))
      .get()
    if (!row) return null

    const lastRenewal = row.expiresAt - SESSION_LIFETIME_MS
    const renewed = now - lastRenewal > RENEW_AFTER_MS
    if (renewed || now - row.lastSeenAt > LAST_SEEN_RESOLUTION_MS) {
      this.db
        .update(sessions)
        .set({ lastSeenAt: now, ...(renewed ? { expiresAt: now + SESSION_LIFETIME_MS } : {}) })
        .where(eq(sessions.id, id))
        .run()
    }
    return { sessionId: id, user: row.user, renewed }
  }

  list(userId: string, now = Date.now()) {
    return this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, now)))
      .all()
  }

  /** Revokes one session of a user; returns false if it does not exist. */
  revoke(userId: string, sessionId: string): boolean {
    const result = this.db
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
      .run()
    return result.changes > 0
  }

  revokeAll(userId: string, exceptSessionId?: string) {
    this.db
      .delete(sessions)
      .where(
        exceptSessionId
          ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId))
          : eq(sessions.userId, userId),
      )
      .run()
  }

  purgeExpired(now = Date.now()) {
    this.db.delete(sessions).where(lt(sessions.expiresAt, now)).run()
  }
}
