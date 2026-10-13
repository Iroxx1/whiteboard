import type { Item } from './items.ts'

/** Markers around matches in search snippets; the web app turns them into <mark> (no HTML from the server). */
export const SEARCH_MARK_START = '\u0002'
export const SEARCH_MARK_END = '\u0003'

/** `GET /api/search` (PLAN.md 5.9): hits grouped like the search dialog shows them. */
export type SearchResult = {
  /** Inbox, archive and placed items (not the trash). */
  items: { item: Item; snippet: string }[]
  boards: { id: string; name: string; hashtag: string }[]
  /** Texts, frame names and item cards on boards; elementId is where to jump to. */
  boardTexts: { boardId: string; boardName: string; elementId: string; snippet: string }[]
}
