import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** 32 random bytes, URL-safe (session cookies, invite/reset/setup links). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Constant-time comparison of two strings of arbitrary length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/** Plausibility check before hashing a token from a URL. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
