// Crockford base32, as used by ULID.
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

/** Generates a ULID (48-bit ms timestamp + 80 bits of randomness). */
export function ulid(now: number = Date.now()): string {
  let time = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    time = ENCODING[t % 32] + time
    t = Math.floor(t / 32)
  }
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let rand = ''
  for (const b of bytes) rand += ENCODING[b % 32]
  return time + rand
}

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value)
}

/** Returns the item id if the URL points to an item permalink (`/i/<ULID>`), on any domain. */
export function itemIdFromLink(link: string): string | null {
  let path: string
  try {
    path = new URL(link, 'http://placeholder.invalid').pathname
  } catch {
    return null
  }
  const match = /^\/i\/([0-9A-HJKMNP-TV-Z]{26})\/?$/.exec(path)
  return match?.[1] ?? null
}
