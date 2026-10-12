// Board hashtags (PLAN.md 5.5): lowercase ASCII, umlauts transliterated (ä → ae …).

export const HASHTAG_MAX_LENGTH = 40
export const HASHTAG_PATTERN = /^[a-z0-9_]{1,40}$/

const TRANSLITERATE: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }

/** Turns arbitrary text (a board name or a typed `#tag`) into a hashtag; may return ''. */
export function normalizeHashtag(input: string): string {
  return input
    .toLowerCase()
    .replace(/[äöüß]/g, (char) => TRANSLITERATE[char] ?? char)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, HASHTAG_MAX_LENGTH)
}
