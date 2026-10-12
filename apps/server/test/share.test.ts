import type { Item } from '@wb/shared'
import { ulid } from '@wb/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { jpegWithExif, multipart } from './fixtures.ts'
import { post, setupAdmin, startApp, type TestApp } from './helpers.ts'

// PWA uploads (PLAN.md 5.6): text first, then every file on its own; all steps idempotent.
describe('share uploads', () => {
  let test: TestApp
  let cookie: string
  let boardId: string

  beforeAll(async () => {
    test = await startApp({ queue: { pollMs: 20 } })
    cookie = await setupAdmin(test)
    boardId = (await post(test.app, '/api/boards', { name: 'Urlaub' }, cookie)).json().id
  })

  afterAll(async () => {
    await test.app.close()
  })

  const uploadFile = (clientShareId: string, index: number, name: string, type: string, data: Buffer) => {
    const body = multipart({ index: String(index) }, [{ name, type, data }])
    return test.app.inject({
      method: 'POST',
      url: `/api/items/share/${clientShareId}/files`,
      headers: { cookie, 'sec-fetch-site': 'same-origin', 'content-type': body.contentType },
      payload: body.payload,
    })
  }

  it('creates a link from an Android share and is idempotent', async () => {
    const clientShareId = ulid()
    const body = { clientShareId, title: 'Ein Artikel', text: 'https://example.org/artikel' }
    const first = await post(test.app, '/api/items/share', body, cookie)
    expect(first.statusCode).toBe(201)
    const items = first.json<{ items: Item[] }>().items
    expect(items).toEqual([expect.objectContaining({ kind: 'link', title: 'Ein Artikel', source: 'pwa' })])
    const again = await post(test.app, '/api/items/share', body, cookie)
    expect(again.json<{ items: Item[] }>().items.map((item) => item.id)).toEqual(items.map((item) => item.id))
  })

  it('uploads files one by one; the text becomes the note of the first file, links join the group', async () => {
    const clientShareId = ulid()
    const text = await post(
      test.app,
      '/api/items/share',
      { clientShareId, text: 'Strandfotos #urlaub https://maps.example/strand', fileCount: 2 },
      cookie,
    )
    const links = text.json<{ items: Item[] }>().items
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ kind: 'link', note: null, targetBoardId: boardId })

    const photo = await jpegWithExif()
    const first = await uploadFile(clientShareId, 0, 'IMG_1.jpg', 'image/jpeg', photo)
    expect(first.statusCode).toBe(201)
    const firstItem = first.json<{ items: Item[] }>().items[0]
    expect(firstItem).toMatchObject({
      kind: 'image',
      note: 'Strandfotos',
      targetBoardId: boardId,
      groupId: links[0]?.groupId,
    })

    // A retry after a lost response returns the same item.
    const retry = await uploadFile(clientShareId, 0, 'IMG_1.jpg', 'image/jpeg', photo)
    expect(retry.json<{ items: Item[] }>().items[0]?.id).toBe(firstItem?.id)

    const second = await uploadFile(clientShareId, 1, 'IMG_2.jpg', 'image/jpeg', photo)
    expect(second.json<{ items: Item[] }>().items[0]).toMatchObject({ note: null, groupId: links[0]?.groupId })

    expect((await uploadFile(clientShareId, 2, 'x.jpg', 'image/jpeg', photo)).statusCode).toBe(400)
    expect((await uploadFile(ulid(), 0, 'x.jpg', 'image/jpeg', photo)).statusCode).toBe(404)

    const repeat = await post(test.app, '/api/items/share', { clientShareId, text: 'egal', fileCount: 2 }, cookie)
    expect(repeat.json<{ items: Item[] }>().items).toHaveLength(3)
  })

  it('handles a single file without text', async () => {
    const clientShareId = ulid()
    const text = await post(
      test.app,
      '/api/items/share',
      { clientShareId, fileCount: 1, title: 'Sprachnachricht' },
      cookie,
    )
    expect(text.json()).toEqual({ items: [], duplicateIds: [] })
    const res = await uploadFile(
      clientShareId,
      0,
      'PTT.opus',
      'audio/ogg',
      Buffer.from('OggS\0\u0002 not really audio'),
    )
    expect(res.json<{ items: Item[] }>().items[0]).toMatchObject({ title: 'Sprachnachricht' })
  })

  it('processes the server fallback when the service worker did not catch the share', async () => {
    const body = multipart({ title: 'Seite', text: 'https://example.org/fallback' }, [])
    const res = await test.app.inject({
      method: 'POST',
      url: '/share-target',
      headers: { cookie, 'content-type': body.contentType, 'sec-fetch-site': 'none' },
      payload: body.payload,
    })
    expect(res.statusCode).toBe(303)
    expect(res.headers.location).toMatch(/^\/share\?done=[0-9A-Z]{26}$/)

    const anonymous = await test.app.inject({
      method: 'POST',
      url: '/share-target',
      headers: { 'content-type': body.contentType, 'sec-fetch-site': 'none' },
      payload: body.payload,
    })
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.headers['content-type']).toContain('text/html')

    const crossSite = await test.app.inject({
      method: 'POST',
      url: '/api/items/share',
      headers: { cookie, 'sec-fetch-site': 'cross-site' },
      payload: { clientShareId: ulid(), text: 'x' },
    })
    expect(crossSite.statusCode).toBe(403)
  })

  it('requires a session', async () => {
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/items/share',
      headers: { 'sec-fetch-site': 'same-origin' },
      payload: { clientShareId: ulid() },
    })
    expect(res.statusCode).toBe(401)
  })
})

describe('share titles', () => {
  it('gives the shared title to the link, not to the file, when both arrive', async () => {
    const test = await startApp()
    const cookie = await setupAdmin(test)
    const clientShareId = ulid()
    const text = await post(
      test.app,
      '/api/items/share',
      { clientShareId, title: 'Eine Seite', text: 'https://example.org/x', fileCount: 1 },
      cookie,
    )
    expect(text.json<{ items: Item[] }>().items[0]).toMatchObject({ kind: 'link', title: 'Eine Seite' })
    const body = multipart({ index: '0' }, [{ name: 'notiz.txt', type: 'text/plain', data: Buffer.from('Hallo') }])
    const file = await test.app.inject({
      method: 'POST',
      url: `/api/items/share/${clientShareId}/files`,
      headers: { cookie, 'sec-fetch-site': 'same-origin', 'content-type': body.contentType },
      payload: body.payload,
    })
    expect(file.json<{ items: Item[] }>().items[0]).toMatchObject({ title: null, meta: { filename: 'notiz.txt' } })
    await test.app.close()
  })
})

describe('concurrent uploads', () => {
  it('creates a file item only once when page and service worker upload at the same time', async () => {
    const test = await startApp()
    const cookie = await setupAdmin(test)
    const clientShareId = ulid()
    const [a, b] = await Promise.all([
      post(test.app, '/api/items/share', { clientShareId, text: 'Zweimal', fileCount: 1 }, cookie),
      post(test.app, '/api/items/share', { clientShareId, text: 'Zweimal', fileCount: 1 }, cookie),
    ])
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201])
    const upload = () => {
      const body = multipart({ index: '0' }, [{ name: 'a.txt', type: 'text/plain', data: Buffer.from('x') }])
      return test.app.inject({
        method: 'POST',
        url: `/api/items/share/${clientShareId}/files`,
        headers: { cookie, 'sec-fetch-site': 'same-origin', 'content-type': body.contentType },
        payload: body.payload,
      })
    }
    const results = await Promise.all([upload(), upload(), upload()])
    const ids = new Set(results.map((res) => res.json<{ items: Item[] }>().items[0]?.id))
    expect(ids.size).toBe(1)
    const inbox = await test.app.inject({ method: 'GET', url: '/api/items?status=inbox', headers: { cookie } })
    expect(inbox.json<{ items: Item[] }>().items).toHaveLength(1)
    await test.app.close()
  })
})
