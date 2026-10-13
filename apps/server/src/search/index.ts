import type { Item, ItemMeta, SearchResult } from '@wb/shared'
import { SEARCH_MARK_END, SEARCH_MARK_START } from '@wb/shared'
import type Database from 'better-sqlite3'
import { and, eq, inArray, isNull, like, ne, or } from 'drizzle-orm'
import type { Db } from '../db/index.ts'
import { boards, items, itemTexts } from '../db/schema.ts'

type DocType = 'item' | 'board' | 'board_text'

/** Text of one element that should be searchable, and where to jump to (PLAN.md 5.9). */
type BoardDoc = { elementId: string; title: string; body: string }

const MIN_TRIGRAM = 3
const LIMIT = 20
const MAX_BODY = 500_000

type SceneLike = {
  id: string
  type?: string
  isDeleted?: boolean
  text?: string
  originalText?: string
  containerId?: string | null
  name?: string | null
  customData?: unknown
}

/**
 * Search documents of one board: text elements (sticky notes jump to their container), frame names
 * and item cards (title of the item).
 */
export function boardDocs(elements: Iterable<SceneLike>, itemTitles: ReadonlyMap<string, string>): BoardDoc[] {
  const docs: BoardDoc[] = []
  const cards = new Set<string>()
  for (const element of elements) {
    if (element.isDeleted) continue
    if (element.type === 'text') {
      const text = (element.originalText ?? element.text ?? '').trim()
      if (text) docs.push({ elementId: element.containerId || element.id, title: '', body: text })
    } else if (element.type === 'frame' || element.type === 'magicframe') {
      if (element.name?.trim()) docs.push({ elementId: element.id, title: element.name.trim(), body: '' })
    }
    const itemId = (element.customData as { wb?: { itemId?: unknown } } | undefined)?.wb?.itemId
    if (typeof itemId === 'string' && !cards.has(itemId)) {
      cards.add(itemId)
      const title = itemTitles.get(itemId)
      if (title) docs.push({ elementId: element.id, title, body: '' })
    }
  }
  return docs
}

/**
 * FTS5 query from user input: every term (at least 3 characters for the trigram index) has to
 * occur; "ss" and "ß" match each other.
 */
export function ftsQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/"/g, '').trim())
    .filter((term) => term.length >= MIN_TRIGRAM)
  if (terms.length === 0) return null
  return terms
    .map((term) => {
      const variants = new Set([term, term.replaceAll('ß', 'ss'), term.replaceAll('ss', 'ß')])
      const quoted = [...variants].filter((variant) => variant.length >= MIN_TRIGRAM).map((variant) => `"${variant}"`)
      return quoted.length > 1 ? `(${quoted.join(' OR ')})` : quoted[0]
    })
    .join(' AND ')
}

/** Lower case without accents, character by character (same length as the input, for the snippet). */
function fold(text: string): string {
  // Per UTF-16 unit, so positions stay the same as in the original text.
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i)
    const base = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    const lower = char.toLowerCase()
    out += base.length === 1 ? base : lower.length === 1 ? lower : char
  }
  return out
}

/** Folded search terms with their ß/ss variants. */
function searchTerms(input: string): string[] {
  return input
    .split(/\s+/)
    .map((term) => fold(term.replace(/"/g, '')))
    .filter((term) => term.length >= MIN_TRIGRAM)
    .flatMap((term) => [term, term.replaceAll('ß', 'ss'), term.replaceAll('ss', 'ß')])
}

const CONTEXT = 70

/**
 * Excerpt around the first hit with the matches marked (FTS5's snippet() marks trigram hits
 * unreliably). Uses the title when the body has no hit.
 */
export function snippet(doc: { title: string; body: string }, terms: string[]): string {
  for (const source of [doc.body, doc.title]) {
    if (!source) continue
    const folded = fold(source)
    const hits: [number, number][] = []
    for (const term of new Set(terms)) {
      for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
        hits.push([at, at + term.length])
      }
    }
    if (hits.length === 0) continue
    hits.sort((a, b) => a[0] - b[0])
    const first = hits[0]?.[0] ?? 0
    const start = Math.max(0, first - CONTEXT)
    const end = Math.min(source.length, first + CONTEXT * 2)
    let out = start > 0 ? '…' : ''
    let pos = start
    for (const [from, to] of hits) {
      if (from < pos || to > end) continue
      out += source.slice(pos, from) + SEARCH_MARK_START + source.slice(from, to) + SEARCH_MARK_END
      pos = to
    }
    out += source.slice(pos, end) + (end < source.length ? '…' : '')
    return out.replace(/\s+/g, ' ').trim()
  }
  return (doc.body || doc.title)
    .slice(0, CONTEXT * 2)
    .replace(/\s+/g, ' ')
    .trim()
}

/** Full-text index in SQLite FTS5, kept up to date by the app (PLAN.md 5.9). */
export class SearchIndex {
  private readonly remove: Database.Statement
  private readonly removeBoardTexts: Database.Statement
  private readonly insert: Database.Statement

  constructor(
    private readonly db: Db,
    private readonly sqlite: Database.Database,
  ) {
    this.remove = sqlite.prepare('DELETE FROM search_fts WHERE doc_type = ? AND doc_id = ?')
    this.removeBoardTexts = sqlite.prepare("DELETE FROM search_fts WHERE doc_type = 'board_text' AND board_id = ?")
    this.insert = sqlite.prepare(
      'INSERT INTO search_fts (title, body, doc_type, doc_id, board_id) VALUES (?, ?, ?, ?, ?)',
    )
  }

  isEmpty(): boolean {
    return !this.sqlite.prepare('SELECT 1 FROM search_fts LIMIT 1').get()
  }

  private put(type: DocType, id: string, title: string, body: string, boardId: string | null = null) {
    this.remove.run(type, id)
    this.insert.run(title, body.slice(0, MAX_BODY), type, id, boardId)
  }

  /** Item: title, note, URL, page name/description, file name and extracted texts. Trashed → removed. */
  indexItem(itemId: string) {
    const row = this.db.select().from(items).where(eq(items.id, itemId)).get()
    if (!row || row.status === 'trashed') {
      this.remove.run('item', itemId)
      return
    }
    const meta = JSON.parse(row.metaJson) as ItemMeta
    const texts = this.db.select({ text: itemTexts.text }).from(itemTexts).where(eq(itemTexts.itemId, itemId)).all()
    const body = [row.note, row.url, meta.siteName, meta.description, meta.filename, ...texts.map((t) => t.text)]
      .filter(Boolean)
      .join('\n')
    this.put('item', itemId, row.title ?? '', body)
  }

  removeItem(itemId: string) {
    this.remove.run('item', itemId)
  }

  /** Board name and hashtag; the texts on it via indexBoardTexts. */
  indexBoard(boardId: string) {
    const board = this.db
      .select({ name: boards.name, hashtag: boards.hashtag, deletedAt: boards.deletedAt })
      .from(boards)
      .where(eq(boards.id, boardId))
      .get()
    if (!board) {
      this.removeBoard(boardId)
      return
    }
    this.put('board', boardId, board.name, `#${board.hashtag}`, boardId)
  }

  /** `reindex_board`: replaces all text documents of a board (after every save). */
  indexBoardTexts(boardId: string, elements: Iterable<SceneLike>) {
    const list = [...elements]
    const cardIds = [
      ...new Set(
        list.flatMap((element) => {
          const id = (element.customData as { wb?: { itemId?: unknown } } | undefined)?.wb?.itemId
          return typeof id === 'string' && !element.isDeleted ? [id] : []
        }),
      ),
    ]
    const titles = new Map<string, string>()
    if (cardIds.length > 0) {
      for (const row of this.db
        .select({ id: items.id, title: items.title, url: items.url })
        .from(items)
        .where(inArray(items.id, cardIds))
        .all()) {
        const title = row.title ?? row.url
        if (title) titles.set(row.id, title)
      }
    }
    const docs = boardDocs(list, titles)
    this.sqlite.transaction(() => {
      this.removeBoardTexts.run(boardId)
      for (const doc of docs) this.insert.run(doc.title, doc.body, 'board_text', doc.elementId, boardId)
    })()
  }

  removeBoard(boardId: string) {
    this.sqlite.transaction(() => {
      this.remove.run('board', boardId)
      this.removeBoardTexts.run(boardId)
    })()
  }

  /** Drops documents of boards and items that no longer exist (after purging the trash). */
  prune() {
    this.sqlite.exec(`
      DELETE FROM search_fts WHERE doc_type IN ('board', 'board_text') AND board_id NOT IN (SELECT id FROM boards);
      DELETE FROM search_fts WHERE doc_type = 'item' AND doc_id NOT IN (SELECT id FROM items);
    `)
  }

  /** Builds the whole index (first start with Phase 7, or after a restore without index). */
  rebuild() {
    this.sqlite.transaction(() => {
      this.sqlite.prepare('DELETE FROM search_fts').run()
      for (const { id } of this.db.select({ id: items.id }).from(items).where(ne(items.status, 'trashed')).all()) {
        this.indexItem(id)
      }
      for (const board of this.db
        .select({ id: boards.id, elementsJson: boards.elementsJson })
        .from(boards)
        .where(isNull(boards.deletedAt))
        .all()) {
        this.indexBoard(board.id)
        this.indexBoardTexts(board.id, JSON.parse(board.elementsJson) as SceneLike[])
      }
    })()
  }

  /** `GET /api/search` (PLAN.md 5.9): grouped hits, best first (bm25), with highlighted snippets. */
  search(input: string, byIds: (ids: string[]) => Item[]): SearchResult {
    const query = ftsQuery(input)
    const terms = searchTerms(input)
    const text = input.trim()
    if (!query) return text ? this.searchShort(text, byIds) : { items: [], boards: [], boardTexts: [] }

    type Row = { doc_type: DocType; doc_id: string; board_id: string | null; title: string; body: string }
    let rows: Row[]
    try {
      rows = this.sqlite
        .prepare(
          `SELECT doc_type, doc_id, board_id, title,
                  body
             FROM search_fts WHERE search_fts MATCH ? ORDER BY bm25(search_fts, 4.0, 1.0) LIMIT 200`,
        )
        .all(query) as Row[]
    } catch {
      return { items: [], boards: [], boardTexts: [] }
    }

    const itemRows = rows.filter((row) => row.doc_type === 'item').slice(0, LIMIT)
    const found = new Map(byIds(itemRows.map((row) => row.doc_id)).map((item) => [item.id, item]))
    const liveBoards = new Map(
      this.db
        .select({ id: boards.id, name: boards.name, hashtag: boards.hashtag })
        .from(boards)
        .where(isNull(boards.deletedAt))
        .all()
        .map((board) => [board.id, board]),
    )
    return {
      items: itemRows.flatMap((row) => {
        const item = found.get(row.doc_id)
        return item && item.status !== 'trashed' ? [{ item, snippet: snippet(row, terms) }] : []
      }),
      boards: rows
        .filter((row) => row.doc_type === 'board' && liveBoards.has(row.doc_id))
        .slice(0, LIMIT)
        .map((row) => ({ ...(liveBoards.get(row.doc_id) as { id: string; name: string; hashtag: string }) })),
      boardTexts: rows
        .filter((row) => row.doc_type === 'board_text' && row.board_id && liveBoards.has(row.board_id))
        .slice(0, LIMIT)
        .map((row) => ({
          boardId: row.board_id as string,
          boardName: liveBoards.get(row.board_id as string)?.name ?? '',
          elementId: row.doc_id,
          snippet: snippet(row, terms),
        })),
    }
  }

  /** Terms under 3 characters: LIKE on titles and board names (PLAN.md 5.9). */
  private searchShort(text: string, byIds: (ids: string[]) => Item[]): SearchResult {
    // Without an ESCAPE clause "%" or "_" in a 1–2 character search simply match more.
    const pattern = `%${text}%`
    const itemIds = this.db
      .select({ id: items.id })
      .from(items)
      .where(and(ne(items.status, 'trashed'), like(items.title, pattern)))
      .limit(LIMIT)
      .all()
      .map((row) => row.id)
    const boardRows = this.db
      .select({ id: boards.id, name: boards.name, hashtag: boards.hashtag })
      .from(boards)
      .where(and(isNull(boards.deletedAt), or(like(boards.name, pattern), like(boards.hashtag, pattern))))
      .limit(LIMIT)
      .all()
    return {
      items: byIds(itemIds).map((item) => ({ item, snippet: item.title ?? '' })),
      boards: boardRows,
      boardTexts: [],
    }
  }
}
