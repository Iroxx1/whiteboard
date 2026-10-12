import { normalizeHashtag } from '@wb/shared'

// `#name` tokens: letters (incl. umlauts), digits, underscore and hyphen; not part of a URL fragment.
const TAG_PATTERN = /(^|[\s(,;])#([\p{L}\p{N}_-]{1,60})/gu

export type HashtagResult = {
  /** Board picked via `#hashtag` (the first known one wins). */
  boardId: string | null
  /** `#inbox` forces "inbox only". */
  inboxOnly: boolean
  /** Hashtags that match no board; they stay in the text. */
  unknown: string[]
  /** Text without the recognised hashtags. */
  text: string
}

/** Resolves `#board` hashtags against the known boards (PLAN.md 5.5, step 2). */
export function resolveHashtags(text: string, boards: ReadonlyMap<string, string>): HashtagResult {
  let boardId: string | null = null
  let inboxOnly = false
  const unknown: string[] = []
  const cleaned = text.replace(TAG_PATTERN, (whole, before: string, raw: string) => {
    const tag = normalizeHashtag(raw)
    if (tag === 'inbox') {
      inboxOnly = true
      return before
    }
    const match = boards.get(tag)
    if (match) {
      boardId ??= match
      return before
    }
    unknown.push(raw)
    return whole
  })
  return {
    boardId: inboxOnly ? null : boardId,
    inboxOnly,
    unknown,
    text: cleaned
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .trim(),
  }
}
