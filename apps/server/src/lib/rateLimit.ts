// In-memory rate limits; fine for a single app instance (PLAN.md 2.3.11).

/** Fixed-window limiter: at most `limit` hits per key and window. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; since: number }>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Counts a hit; returns false when the key is over the limit. */
  take(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key)
    if (!entry || now - entry.since >= this.windowMs) {
      this.hits.set(key, { count: 1, since: now })
      this.prune(now)
      return true
    }
    entry.count += 1
    return entry.count <= this.limit
  }

  private prune(now: number) {
    if (this.hits.size < 10_000) return
    for (const [key, entry] of this.hits) if (now - entry.since >= this.windowMs) this.hits.delete(key)
  }
}

const WINDOW_MS = 15 * 60 * 1000
const FREE_FAILURES = 5
const MAX_LOCK_MS = 60 * 60 * 1000

/**
 * Login protection (PLAN.md 5.12): 5 failures per 15 minutes per IP + e-mail, then a waiting
 * time that doubles with every further failure (1 min, 2 min, 4 min … up to 1 h).
 */
export class LoginThrottle {
  private readonly entries = new Map<string, { failures: number; since: number; lockedUntil: number }>()

  /** The entry for `key` unless it has expired (15 min without failures, or 15 min after a lock). */
  private current(key: string, now: number) {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    const quietSince = entry.lockedUntil === 0 ? entry.since : entry.lockedUntil
    if (now - quietSince >= WINDOW_MS) {
      this.entries.delete(key)
      return undefined
    }
    return entry
  }

  /** Milliseconds to wait before the next attempt is allowed (0 = allowed now). */
  retryAfter(key: string, now = Date.now()): number {
    const entry = this.current(key, now)
    return entry ? Math.max(0, entry.lockedUntil - now) : 0
  }

  fail(key: string, now = Date.now()) {
    let entry = this.current(key, now)
    if (!entry) {
      entry = { failures: 0, since: now, lockedUntil: 0 }
      this.entries.set(key, entry)
    }
    entry.failures += 1
    if (entry.failures >= FREE_FAILURES) {
      entry.lockedUntil = now + Math.min(MAX_LOCK_MS, 60_000 * 2 ** (entry.failures - FREE_FAILURES))
    }
  }

  succeed(key: string) {
    this.entries.delete(key)
  }
}
