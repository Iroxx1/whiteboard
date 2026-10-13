import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ItemDetail, SceneElement, SearchResult } from '@wb/shared'
import { SEARCH_MARK_END, SEARCH_MARK_START } from '@wb/shared'
import { io, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { articleText } from '../src/processors/article.ts'
import { boardDocs, ftsQuery, snippet } from '../src/search/index.ts'
import { ORIGIN_HEADERS, PUBLIC_URL, post, setupAdmin, startApp, type TestApp } from './helpers.ts'

const SAVE_DELAY_MS = 50

const ARTICLE = `<!doctype html><html><head><title>Wandern im Harz</title></head><body>
<nav>Startseite · Kontakt · Impressum</nav>
<article><h1>Wandern im Harz</h1>
<p>Der Hexenstieg ist ein Fernwanderweg quer durch den Harz. Er führt über knapp hundert Kilometer
von Osterode bis Thale und gilt als einer der schönsten Wege Deutschlands.</p>
<p>Unterwegs kommt man an Talsperren, Hochmooren und dem Brocken vorbei. Wer die ganze Strecke gehen
möchte, sollte fünf bis sechs Tage einplanen und Unterkünfte rechtzeitig buchen.</p>
<p>Die beste Zeit für die Tour ist der Spätsommer, wenn die Heidelbeeren reif sind.</p></article>
<footer>© Beispielverlag</footer></body></html>`

function element(id: string, extra: Partial<SceneElement> & Record<string, unknown>): SceneElement {
  return { id, type: 'rectangle', version: 1, versionNonce: 1, index: `a${id}`, updated: Date.now(), x: 0, ...extra }
}

describe('search helpers', () => {
  it('builds trigram queries with ß/ss variants and ignores short terms', () => {
    expect(ftsQuery('tür')).toBe('"tür"')
    expect(ftsQuery('Straße am')).toBe('("straße" OR "strasse")')
    expect(ftsQuery('a b')).toBeNull()
    expect(ftsQuery('sag "hallo"')).toBe('"sag" AND "hallo"')
  })

  it('marks hits in snippets regardless of case, accents and ß/ss', () => {
    const mark = (text: string) => `${SEARCH_MARK_START}${text}${SEARCH_MARK_END}`
    expect(snippet({ title: '', body: 'Das   Haus ist schön' }, ['haus'])).toBe(`Das ${mark('Haus')} ist schön`)
    expect(snippet({ title: 'Café am Markt', body: '' }, ['cafe'])).toBe(`${mark('Café')} am Markt`)
    expect(snippet({ title: '', body: 'Große Straße' }, ['straße', 'strasse'])).toBe(`Große ${mark('Straße')}`)
    const long = `${'a '.repeat(100)}Ziel${' b'.repeat(100)}`
    const cut = snippet({ title: '', body: long }, ['ziel'])
    expect(cut.startsWith('…') && cut.endsWith('…')).toBe(true)
    expect(cut).toContain(mark('Ziel'))
  })

  it('takes texts, frame names and item cards from a board', () => {
    const docs = boardDocs(
      [
        { id: 'r1', type: 'rectangle' },
        { id: 't1', type: 'text', originalText: 'Haustür streichen', containerId: 'r1' },
        { id: 't2', type: 'text', text: 'frei', isDeleted: true },
        { id: 'f1', type: 'frame', name: 'Ideen' },
        { id: 'c1', type: 'embeddable', customData: { wb: { itemId: 'item-1' } } },
        { id: 'c2', type: 'text', customData: { wb: { itemId: 'item-1' } }, text: '' },
      ],
      new Map([['item-1', 'Ferienhaus']]),
    )
    expect(docs).toEqual([
      { elementId: 'r1', title: '', body: 'Haustür streichen' },
      { elementId: 'f1', title: 'Ideen', body: '' },
      { elementId: 'c1', title: 'Ferienhaus', body: '' },
    ])
  })

  it('extracts the reading text of an article page', () => {
    const text = articleText(ARTICLE, 'https://example.org/harz')
    expect(text).toContain('Hexenstieg ist ein Fernwanderweg')
    expect(text).not.toContain('Impressum')
    expect(articleText('<html><body><p>Kurz.</p></body></html>', 'https://example.org/')).toBeNull()
  })
})

// Full-text search (PLAN.md 5.9, Phase 7).
describe('search', () => {
  let test: TestApp
  let cookie: string
  let boardId: string
  let site: http.Server
  let sitePort: number
  let url: string
  const sockets: Socket[] = []

  const search = async (q: string) =>
    (await test.app.inject({ url: `/api/search?q=${encodeURIComponent(q)}`, headers: { cookie } })).json<SearchResult>()
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const until = async <T>(read: () => Promise<T>, ok: (value: T) => boolean) => {
    for (let i = 0; i < 200; i++) {
      const value = await read()
      if (ok(value)) return value
      await sleep(25)
    }
    throw new Error('condition not met')
  }

  beforeAll(async () => {
    site = http.createServer((_req, res) =>
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(ARTICLE),
    )
    await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve))
    sitePort = (site.address() as AddressInfo).port
    test = await startApp({
      rooms: { saveDelayMs: SAVE_DELAY_MS },
      queue: { pollMs: 20, backoffMs: [10, 10] },
      fetchOptions: {
        lookup: async () => [{ address: '127.0.0.1', family: 4 }],
        allowAddress: (address) => address === '127.0.0.1',
        allowPorts: [sitePort],
      },
    })
    cookie = await setupAdmin(test)
    boardId = (await post(test.app, '/api/boards', { name: 'Renovierung Haus', hashtag: 'haus' }, cookie)).json().id
    await test.app.listen({ host: '127.0.0.1', port: 0 })
    url = `http://127.0.0.1:${(test.app.server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect()
    await test.app.close()
    await new Promise<void>((resolve) => site.close(() => resolve()))
  })

  it('finds a link by a word from its article, shows the reading text in the details', async () => {
    const res = await post(test.app, '/api/items', { text: `http://harz.example:${sitePort}/hexenstieg` }, cookie)
    const id = res.json().items[0].id as string
    const detail = await until(
      async () => (await test.app.inject({ url: `/api/items/${id}`, headers: { cookie } })).json<ItemDetail>(),
      (item) => item.texts.some((text) => text.kind === 'article'),
    )
    expect(detail.texts.find((text) => text.kind === 'article')?.text).toContain('Heidelbeeren')
    const result = await search('heidelbeer')
    expect(result.items.map((hit) => hit.item.id)).toEqual([id])
    expect(result.items[0]?.snippet).toContain(`${SEARCH_MARK_START}Heidelbeer${SEARCH_MARK_END}`)
  })

  it('finds notes by word parts, umlauts, ß/ss; trashed items disappear', async () => {
    const note = (await post(test.app, '/api/items', { text: 'Neue Haustür für die Straße bestellen' }, cookie)).json()
      .items[0].id as string
    expect((await search('tür')).items.map((hit) => hit.item.id)).toContain(note)
    expect((await search('HAUSTÜR')).items.map((hit) => hit.item.id)).toContain(note)
    expect((await search('strasse')).items.map((hit) => hit.item.id)).toContain(note)
    expect((await search('haustür bestellen')).items.map((hit) => hit.item.id)).toEqual([note])
    await test.app.inject({ method: 'DELETE', url: `/api/items/${note}`, headers: { cookie, ...ORIGIN_HEADERS } })
    expect((await search('haustür')).items).toEqual([])
    await post(test.app, `/api/items/${note}/restore`, {}, cookie)
    expect((await search('haustür')).items.map((hit) => hit.item.id)).toEqual([note])
  })

  it('finds boards by name and texts on boards, with the element to jump to', async () => {
    expect((await search('renovier')).boards).toEqual([{ id: boardId, name: 'Renovierung Haus', hashtag: 'haus' }])
    // Short terms: LIKE on names.
    expect((await search('Re')).boards.map((board) => board.id)).toContain(boardId)

    const socket = await new Promise<Socket>((resolve, reject) => {
      const client = io(url, {
        transports: ['websocket'],
        extraHeaders: { cookie, origin: PUBLIC_URL },
        reconnection: false,
      })
      sockets.push(client)
      client.on('connect', () => resolve(client))
      client.on('connect_error', reject)
    })
    await socket.emitWithAck('board:join', { boardId })
    await socket.emitWithAck('board:update', {
      boardId,
      elements: [
        element('note1', { type: 'rectangle' }),
        element('text1', {
          type: 'text',
          text: 'Fliesen im Badezimmer',
          originalText: 'Fliesen im Badezimmer',
          containerId: 'note1',
        }),
      ],
    })
    const result = await until(
      () => search('badezimmer'),
      (value) => value.boardTexts.length > 0,
    )
    expect(result.boardTexts).toEqual([
      { boardId, boardName: 'Renovierung Haus', elementId: 'note1', snippet: expect.stringContaining('Badezimmer') },
    ])

    // Rename is searchable at once; a deleted board and its texts are not found.
    await test.app.inject({
      method: 'PATCH',
      url: `/api/boards/${boardId}`,
      headers: { cookie, ...ORIGIN_HEADERS },
      payload: { name: 'Umbau' },
    })
    expect((await search('umbau')).boards.map((board) => board.id)).toEqual([boardId])
    await test.app.inject({ method: 'DELETE', url: `/api/boards/${boardId}`, headers: { cookie, ...ORIGIN_HEADERS } })
    const gone = await search('badezimmer')
    expect(gone.boardTexts).toEqual([])
    expect((await search('umbau')).boards).toEqual([])
  })

  it('rejects overly long queries and returns nothing for empty ones', async () => {
    expect((await search('')).items).toEqual([])
    const long = await test.app.inject({ url: `/api/search?q=${'x'.repeat(300)}`, headers: { cookie } })
    expect(long.statusCode).toBe(400)
  })
})
