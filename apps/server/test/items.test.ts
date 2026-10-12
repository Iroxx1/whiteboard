import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ClaimAck, Item, ItemDetail, JoinAck, PlacementPending, SceneElement } from '@wb/shared'
import sharp from 'sharp'
import { io, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ffmpegClip, hasTool, jpegWithExif, multipart, tinyPdf } from './fixtures.ts'
import { inviteUser, PUBLIC_URL, post, setupAdmin, startApp, type TestApp } from './helpers.ts'

const SAVE_DELAY_MS = 50

describe('inbox items', () => {
  let test: TestApp
  let site: http.Server
  let sitePort: number
  let maik: string
  let anna: string
  let boardId: string
  let url: string
  const sockets: Socket[] = []

  beforeAll(async () => {
    // A tiny "website" with OpenGraph tags and a preview image.
    const ogImage = await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#e64980' } })
      .png()
      .toBuffer()
    site = http.createServer((req, res) => {
      if (req.url === '/og.png') {
        res.writeHead(200, { 'content-type': 'image/png' }).end(ogImage)
      } else if (req.url === '/plain') {
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end('<html><head><title>Nur ein Titel</title></head></html>')
      } else {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
          `<html><head><meta property="og:title" content="Ferienhaus am Meer">
          <meta property="og:description" content="Schöne Lage">
          <meta property="og:site_name" content="Beispiel">
          <meta property="og:image" content="/og.png"></head></html>`,
        )
      }
    })
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
    maik = await setupAdmin(test)
    anna = await inviteUser(test, maik, 'Anna', 'anna@example.test')
    boardId = (await post(test.app, '/api/boards', { name: 'Urlaub' }, maik)).json().id
    await test.app.listen({ host: '127.0.0.1', port: 0 })
    url = `http://127.0.0.1:${(test.app.server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect()
    await test.app.close()
    await new Promise<void>((resolve) => site.close(() => resolve()))
  })

  const waitReady = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const item = (await get(`/api/items/${id}`)).json<ItemDetail>()
      if (item.processing !== 'pending') return item
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('processing did not finish')
  }
  const get = (path: string, cookie = maik) => test.app.inject({ method: 'GET', url: path, headers: { cookie } })
  const upload = (fields: Record<string, string>, files: { name: string; type: string; data: Buffer }[]) => {
    const body = multipart(fields, files)
    return test.app.inject({
      method: 'POST',
      url: '/api/items',
      headers: { cookie: maik, 'sec-fetch-site': 'same-origin', 'content-type': body.contentType },
      payload: body.payload,
    })
  }

  it('adds a link and builds a preview through the safe fetch', async () => {
    const res = await post(test.app, '/api/items', { text: `Schau mal http://site.test:${sitePort}/haus` }, maik)
    expect(res.statusCode).toBe(201)
    const [created] = res.json<{ items: Item[] }>().items
    expect(created).toMatchObject({
      kind: 'link',
      source: 'web',
      note: 'Schau mal',
      createdByName: 'Maik',
      processing: 'pending',
    })
    const item = await waitReady(created?.id ?? '')
    expect(item).toMatchObject({
      title: 'Ferienhaus am Meer',
      meta: { domain: 'site.test', description: 'Schöne Lage', siteName: 'Beispiel' },
    })
    expect(item.assets.og_image).toMatchObject({ mime: 'image/webp', width: 800 })
    const image = await get(`/api/assets/${item.assets.og_image?.id}`)
    expect(image.statusCode).toBe(200)
    expect(image.headers['content-security-policy']).toBe("sandbox; default-src 'none'")
  })

  it('reuses a link that is already in the inbox', async () => {
    const res = await post(
      test.app,
      '/api/items',
      { url: `http://site.test:${sitePort}/haus?utm_source=x`, text: 'Noch mal' },
      anna,
    )
    expect(res.json()).toMatchObject({ duplicateIds: [expect.any(String)] })
    const item = res.json<{ items: Item[] }>().items[0]
    expect(item?.note).toBe('Schau mal\n\nNoch mal')
  })

  it('takes the page title from text that equals it', async () => {
    const res = await post(test.app, '/api/items', { text: `Nur ein Titel http://site.test:${sitePort}/plain` }, maik)
    const item = await waitReady(res.json<{ items: Item[] }>().items[0]?.id ?? '')
    expect(item).toMatchObject({ title: 'Nur ein Titel', note: null })
  })

  it('processes images: EXIF rotation, display and thumbnail without metadata', async () => {
    const res = await upload({ text: 'Strand' }, [
      { name: 'IMG_0001.JPG', type: 'image/jpeg', data: await jpegWithExif() },
    ])
    const [created] = res.json<{ items: Item[] }>().items
    expect(created).toMatchObject({
      kind: 'image',
      note: 'Strand',
      meta: { filename: 'IMG_0001.JPG', mime: 'image/jpeg' },
    })
    const item = await waitReady(created?.id ?? '')
    expect(item.processing).toBe('ready')
    // Orientation 6: 300×200 becomes 200×300.
    expect(item.meta).toMatchObject({ width: 200, height: 300 })
    const display = await get(`/api/assets/${item.assets.display?.id}`)
    const meta = await sharp(display.rawPayload).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.exif).toBeUndefined()
    expect(item.assets.thumb).toBeDefined()
    const original = await get(`/api/assets/${item.assets.original?.id}?download=1`)
    expect(original.headers['content-disposition']).toMatch(/^attachment; filename="IMG_0001.JPG"/)
    // The display version doubles as Excalidraw file for native images on the board.
    expect((await get(`/api/files/${item.assets.display?.id}`)).statusCode).toBe(200)
  })

  it('treats files by content, not by name, and groups a multi-file share', async () => {
    const res = await upload({}, [
      { name: 'notizen.txt', type: 'text/plain', data: Buffer.from('Einkauf\nMilch\nBrot\n') },
      { name: 'getarnt.txt', type: 'text/plain', data: tinyPdf() },
      { name: 'seite.html', type: 'text/html', data: Buffer.from('<script>alert(1)</script>') },
    ])
    const created = res.json<{ items: Item[] }>().items
    expect(created.map((item) => item.kind)).toEqual(['document', 'pdf', 'document'])
    expect(new Set(created.map((item) => item.groupId)).size).toBe(1)
    const text = await waitReady(created[0]?.id ?? '')
    expect(text.meta.textPreview).toBe('Einkauf\nMilch\nBrot')
    expect(text.texts).toEqual([{ kind: 'doc', text: 'Einkauf\nMilch\nBrot\n' }])
    const html = await get(`/api/assets/${created[2]?.assets.original?.id}`)
    expect(html.headers['content-disposition']).toMatch(/^attachment/)
    expect(html.headers['content-type']).toContain('text/html')
  })

  it.runIf(hasTool('pdftoppm', ['-v']))('processes PDFs: pages, preview and text', async () => {
    const res = await upload({}, [{ name: 'plan.pdf', type: 'application/pdf', data: tinyPdf() }])
    const item = await waitReady(res.json<{ items: Item[] }>().items[0]?.id ?? '')
    expect(item.processing).toBe('ready')
    expect(item.meta.pageCount).toBe(1)
    expect(item.assets.page1?.mime).toBe('image/webp')
    expect(item.texts.find((entry) => entry.kind === 'pdf')?.text).toContain('Hallo Whiteboard')
  })

  it.runIf(hasTool('ffmpeg'))('processes audio and video', async () => {
    const res = await upload({}, [
      { name: 'PTT-20261012.opus', type: 'audio/ogg', data: ffmpegClip('audio') },
      { name: 'clip.mp4', type: 'video/mp4', data: ffmpegClip('video') },
    ])
    const [audio, video] = res.json<{ items: Item[] }>().items
    expect(audio?.kind).toBe('audio')
    expect(video?.kind).toBe('video')
    const audioItem = await waitReady(audio?.id ?? '')
    expect(audioItem.meta.durationMs).toBeGreaterThan(1500)
    const videoItem = await waitReady(video?.id ?? '')
    expect(videoItem.meta).toMatchObject({ width: 320, height: 240 })
    expect(videoItem.assets.poster?.mime).toBe('image/webp')
    // Seeking needs range requests.
    const range = await test.app.inject({
      method: 'GET',
      url: `/api/assets/${videoItem.assets.original?.id}`,
      headers: { cookie: maik, range: 'bytes=0-99' },
    })
    expect(range.statusCode).toBe(206)
    expect(range.rawPayload.length).toBe(100)
  })

  it('lists, archives, trashes and restores', async () => {
    const list = (await get('/api/items?status=inbox')).json<{ items: Item[] }>()
    expect(list.items.length).toBeGreaterThan(3)
    const note = (await post(test.app, '/api/items', { text: 'Idee: Fahrräder mitnehmen' }, maik)).json<{
      items: Item[]
    }>().items[0] as Item
    expect(note).toMatchObject({ kind: 'note', processing: 'ready' })
    const patch = (body: object) =>
      test.app.inject({
        method: 'PATCH',
        url: `/api/items/${note.id}`,
        headers: { cookie: maik, 'sec-fetch-site': 'same-origin' },
        payload: body,
      })
    expect((await patch({ status: 'archived', title: 'Fahrräder' })).json()).toMatchObject({
      status: 'archived',
      title: 'Fahrräder',
    })
    expect((await get('/api/items?status=archived')).json().items.map((item: Item) => item.id)).toContain(note.id)
    const del = await test.app.inject({
      method: 'DELETE',
      url: `/api/items/${note.id}`,
      headers: { cookie: maik, 'sec-fetch-site': 'same-origin' },
    })
    expect(del.statusCode).toBe(204)
    expect((await get('/api/items?status=trashed')).json().items[0].id).toBe(note.id)
    expect((await post(test.app, `/api/items/${note.id}/restore`, {}, maik)).statusCode).toBe(204)
    expect((await get(`/api/items/${note.id}`)).json().status).toBe('archived')
    const page = (await get('/api/items?status=inbox&limit=2')).json()
    expect(page.items).toHaveLength(2)
    const next = (await get(`/api/items?status=inbox&limit=2&cursor=${page.nextCursor}`)).json()
    expect(next.items[0].id < page.items[1].id).toBe(true)
  })

  it('places an item with a target board exactly once with two clients', async () => {
    const connect = (cookie: string) =>
      new Promise<Socket>((resolve, reject) => {
        const socket = io(url, {
          transports: ['websocket'],
          extraHeaders: { cookie, origin: PUBLIC_URL },
          reconnection: false,
        })
        sockets.push(socket)
        socket.on('connect', () => resolve(socket))
        socket.on('connect_error', reject)
      })
    const a = await connect(maik)
    const b = await connect(anna)
    for (const socket of [a, b])
      expect(((await socket.emitWithAck('board:join', { boardId })) as JoinAck).ok).toBe(true)

    const pendingA = new Promise<PlacementPending>((resolve) => a.once('placement:pending', resolve))
    const pendingB = new Promise<PlacementPending>((resolve) => b.once('placement:pending', resolve))
    const created = (await post(test.app, '/api/items', { text: 'Sonnencreme #urlaub' }, maik)).json<{
      items: Item[]
    }>().items[0] as Item
    expect(created.targetBoardId).toBe(boardId)
    expect((await pendingA).itemIds).toContain(created.id)
    expect((await pendingB).itemIds).toContain(created.id)

    const claims = (await Promise.all(
      [a, b].map((socket) => socket.emitWithAck('placement:claim', { itemId: created.id, boardId })),
    )) as ClaimAck[]
    const winners = claims.filter((claim) => claim.ok && claim.granted)
    expect(winners).toHaveLength(1)
    const loser = claims.find((claim) => claim.ok && !claim.granted)
    expect(loser).toMatchObject({ holder: expect.any(String) })

    const winner = claims[0]?.ok && claims[0].granted ? a : b
    const element: SceneElement = {
      id: 'note-1',
      type: 'rectangle',
      version: 1,
      versionNonce: 1,
      index: 'a1',
      customData: { wb: { itemId: created.id, kind: 'note' } },
    }
    // Done before the elements arrived is rejected.
    expect(
      await winner.emitWithAck('placement:done', { itemId: created.id, boardId, elementIds: ['note-1'] }),
    ).toMatchObject({
      ok: false,
    })
    await winner.emitWithAck('board:update', { boardId, elements: [element] })
    expect(await winner.emitWithAck('placement:done', { itemId: created.id, boardId, elementIds: ['note-1'] })).toEqual(
      {
        ok: true,
      },
    )
    const placed = (await get(`/api/items/${created.id}`)).json<ItemDetail>()
    expect(placed.status).toBe('placed')
    expect(placed.placements).toEqual([{ boardId, boardName: 'Urlaub', deleted: false }])
    expect((await winner.emitWithAck('board:join', { boardId })) as JoinAck).toMatchObject({ pendingItemIds: [] })

    // Deleting the element on the board archives the item (PLAN.md 5.4 "Abgleich").
    await winner.emitWithAck('board:update', { boardId, elements: [{ ...element, version: 2, isDeleted: true }] })
    await new Promise((resolve) => setTimeout(resolve, SAVE_DELAY_MS * 4))
    expect((await get(`/api/items/${created.id}`)).json().status).toBe('archived')

    // A copy of an item element on the board makes it "placed" again; undo puts it back to the inbox.
    await winner.emitWithAck('board:update', { boardId, elements: [{ ...element, id: 'note-2', version: 1 }] })
    await new Promise((resolve) => setTimeout(resolve, SAVE_DELAY_MS * 4))
    expect((await get(`/api/items/${created.id}`)).json().status).toBe('placed')
    await winner.emitWithAck('board:update', {
      boardId,
      elements: [{ ...element, id: 'note-2', version: 2, isDeleted: true }],
    })
    expect((await post(test.app, `/api/items/${created.id}/unplace`, { boardId }, maik)).statusCode).toBe(204)
    await new Promise((resolve) => setTimeout(resolve, SAVE_DELAY_MS * 4))
    expect((await get(`/api/items/${created.id}`)).json()).toMatchObject({ status: 'inbox', targetBoardId: null })
  })

  it('rejects anonymous access and empty input', async () => {
    expect((await test.app.inject({ method: 'GET', url: '/api/items' })).statusCode).toBe(401)
    expect((await test.app.inject({ method: 'GET', url: '/api/assets/01JAB3C4D5E6F7G8H9JKMNPQRS' })).statusCode).toBe(
      401,
    )
    expect((await post(test.app, '/api/items', { text: '   ' }, maik)).statusCode).toBe(400)
  })
})
