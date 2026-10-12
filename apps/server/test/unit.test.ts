import { describe, expect, it } from 'vitest'
import { checkPassword } from '../src/auth/password.ts'
import { expiredTombstones, snapshotsToDelete } from '../src/boards/snapshots.ts'
import { sniffBoardImage } from '../src/files/sniff.ts'
import { LoginThrottle, RateLimiter } from '../src/lib/rateLimit.ts'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('snapshotsToDelete', () => {
  const now = Date.UTC(2026, 9, 12, 12, 0)
  const snap = (id: string, ageMs: number, reason: 'auto' | 'manual' | 'before_restore' = 'auto') => ({
    id,
    createdAt: now - ageMs,
    reason,
  })

  it('keeps everything from the last 48 hours', () => {
    const list = [snap('a', HOUR), snap('b', 2 * HOUR), snap('c', 47 * HOUR)]
    expect(snapshotsToDelete(list, now)).toEqual([])
  })

  it('keeps the newest per day for 30 days, then per week, then nothing', () => {
    const list = [
      snap('d3-late', 3 * DAY),
      snap('d3-early', 3 * DAY + 2 * HOUR),
      snap('d10', 10 * DAY),
      snap('d10b', 10 * DAY + HOUR),
      snap('w1', 60 * DAY),
      snap('w1b', 61 * DAY),
      snap('old', 200 * DAY),
    ]
    expect(snapshotsToDelete(list, now).sort()).toEqual(['d10b', 'd3-early', 'old', 'w1b'].sort())
  })

  it('never deletes manual snapshots', () => {
    expect(snapshotsToDelete([snap('m', 400 * DAY, 'manual'), snap('m2', 3 * DAY, 'manual')], now)).toEqual([])
  })
})

describe('expiredTombstones', () => {
  it('drops deleted elements older than 7 days only', () => {
    const now = Date.now()
    const elements = [
      { id: 'old', type: 'x', version: 2, versionNonce: 1, isDeleted: true, updated: now - 8 * DAY },
      { id: 'recent', type: 'x', version: 2, versionNonce: 1, isDeleted: true, updated: now - DAY },
      { id: 'alive', type: 'x', version: 2, versionNonce: 1, updated: now - 30 * DAY },
    ]
    expect(expiredTombstones(elements, now)).toEqual(['old'])
  })
})

describe('checkPassword', () => {
  it('enforces length and rejects common or personal passwords', () => {
    expect(checkPassword('kurz')).toBe('too_short')
    expect(checkPassword('x'.repeat(201))).toBe('too_long')
    expect(checkPassword('Passwort123')).toBe('common')
    expect(checkPassword('aaaaaaaaaaaa')).toBe('common')
    expect(checkPassword('anna.mueller@example.test', ['anna.mueller@example.test'])).toBe('common')
    expect(checkPassword('anna.mueller', ['anna.mueller@example.test'])).toBe('common')
    expect(checkPassword('korrekt-pferd-batterie', ['anna@example.test', 'Anna'])).toBeNull()
  })
})

describe('rate limits', () => {
  it('RateLimiter allows `limit` hits per window', () => {
    const limiter = new RateLimiter(2, 1000)
    expect([limiter.take('k', 0), limiter.take('k', 1), limiter.take('k', 2)]).toEqual([true, true, false])
    expect(limiter.take('k', 1000)).toBe(true)
  })

  it('LoginThrottle locks after 5 failures with a growing wait', () => {
    const throttle = new LoginThrottle()
    for (let i = 0; i < 4; i++) throttle.fail('k', 0)
    expect(throttle.retryAfter('k', 0)).toBe(0)
    throttle.fail('k', 0)
    expect(throttle.retryAfter('k', 0)).toBe(60_000)
    throttle.fail('k', 60_000)
    expect(throttle.retryAfter('k', 60_000)).toBe(120_000)
    // 15 minutes after the lock ended everything is forgotten.
    expect(throttle.retryAfter('k', 60_000 + 120_000 + 15 * 60_000)).toBe(0)
    throttle.fail('other', 0)
    throttle.succeed('other')
    expect(throttle.retryAfter('other', 0)).toBe(0)
  })
})

describe('sniffBoardImage', () => {
  it('detects real image types and rejects everything else', () => {
    expect(sniffBoardImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png')
    expect(sniffBoardImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffBoardImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(sniffBoardImage(Buffer.from('﻿  <svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml')
    expect(sniffBoardImage(Buffer.from('<html><svg></svg></html>'))).toBeNull()
    expect(sniffBoardImage(Buffer.from('hello'))).toBeNull()
  })
})
