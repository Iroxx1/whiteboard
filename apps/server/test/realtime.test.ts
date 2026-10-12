import type { AddressInfo } from 'node:net'
import type { JoinAck, PresenceBroadcast, SceneElement, UpdateAck } from '@wb/shared'
import { io, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inviteUser, PUBLIC_URL, post, setupAdmin, startApp, type TestApp } from './helpers.ts'

const SAVE_DELAY_MS = 50

function element(id: string, version: number, extra: Partial<SceneElement> = {}): SceneElement {
  return {
    id,
    type: 'rectangle',
    version,
    versionNonce: 1000 + version,
    index: `a${id}`,
    updated: Date.now(),
    x: 0,
    ...extra,
  }
}

describe('realtime board sync', () => {
  let test: TestApp
  let url: string
  let maik: string
  let anna: string
  let boardId: string
  const sockets: Socket[] = []

  const listen = async () => {
    await test.app.listen({ host: '127.0.0.1', port: 0 })
    url = `http://127.0.0.1:${(test.app.server.address() as AddressInfo).port}`
  }

  const connect = (cookie: string, origin = PUBLIC_URL) =>
    new Promise<Socket>((resolve, reject) => {
      const socket = io(url, { transports: ['websocket'], extraHeaders: { cookie, origin }, reconnection: false })
      sockets.push(socket)
      socket.on('connect', () => resolve(socket))
      socket.on('connect_error', reject)
    })

  const join = (socket: Socket, id = boardId) => socket.emitWithAck('board:join', { boardId: id }) as Promise<JoinAck>
  const update = (socket: Socket, elements: SceneElement[]) =>
    socket.emitWithAck('board:update', { boardId, elements }) as Promise<UpdateAck>
  const next = <T>(socket: Socket, event: string) =>
    new Promise<T>((resolve) => socket.once(event, (payload: T) => resolve(payload)))
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const boardState = async (cookie = maik) =>
    (await test.app.inject({ method: 'GET', url: `/api/boards/${boardId}`, headers: { cookie } })).json<{
      version: number
      elements: SceneElement[]
      fileIds: string[]
    }>()

  beforeAll(async () => {
    test = await startApp({ rooms: { saveDelayMs: SAVE_DELAY_MS } })
    maik = await setupAdmin(test)
    anna = await inviteUser(test, maik, 'Anna', 'anna@example.test')
    boardId = (await post(test.app, '/api/boards', { name: 'Test' }, maik)).json().id
    await listen()
  })

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect()
    await test.app.close()
  })

  it('rejects connections without session or from a foreign origin', async () => {
    await expect(connect('wb_session=nope')).rejects.toThrow(/unauthorized/)
    await expect(connect(maik, 'https://evil.example')).rejects.toThrow()
  })

  it('accepts same-origin long polling without an Origin header', async () => {
    const poll = (headers: Record<string, string>) =>
      new Promise<Socket>((resolve, reject) => {
        const socket = io(url, { transports: ['polling'], extraHeaders: headers, reconnection: false })
        sockets.push(socket)
        socket.on('connect', () => resolve(socket))
        socket.on('connect_error', reject)
      })
    const socket = await poll({ cookie: maik, 'sec-fetch-site': 'same-origin' })
    socket.disconnect()
    await expect(poll({ cookie: maik })).rejects.toThrow()
    await expect(poll({ cookie: maik, 'sec-fetch-site': 'cross-site' })).rejects.toThrow()
  })

  it('syncs element changes between two users', async () => {
    const a = await connect(maik)
    const b = await connect(anna)
    expect(await join(a)).toMatchObject({ ok: true, elements: [], pendingItemIds: [] })
    expect((await join(b)).ok).toBe(true)
    expect((await join(b, 'missing')).ok).toBe(false)

    const received = next<{ elements: SceneElement[] }>(b, 'board:update')
    const started = Date.now()
    expect(await update(a, [element('1', 1), element('2', 1)])).toEqual({ ok: true })
    const payload = await received
    expect(Date.now() - started).toBeLessThan(1000)
    expect(payload.elements.map((entry) => entry.id)).toEqual(['1', '2'])

    // An older version is ignored and not forwarded.
    let forwarded = false
    a.once('board:update', () => {
      forwarded = true
    })
    await update(b, [element('1', 0)])
    await update(b, [element('2', 2, { x: 99 })])
    await sleep(100)
    expect(forwarded).toBe(true)
    const state = await boardState()
    expect(state.elements.find((entry) => entry.id === '1')?.version).toBe(1)
    expect(state.elements.find((entry) => entry.id === '2')).toMatchObject({ version: 2, x: 99 })
  })

  it('shares cursors with name and colour', async () => {
    const [a, b] = sockets.slice(-2) as [Socket, Socket]
    const received = next<PresenceBroadcast>(b, 'presence:update')
    a.emit('presence:update', {
      boardId,
      pointer: { x: 10, y: 20, tool: 'pointer' },
      button: 'up',
      selectedElementIds: { '1': true },
    })
    expect(await received).toMatchObject({ name: 'Maik', pointer: { x: 10, y: 20 }, socketId: a.id })
    const left = next<{ socketId: string }>(b, 'presence:leave')
    a.emit('board:leave', { boardId })
    expect((await left).socketId).toBe(a.id)
    expect((await update(a, [element('3', 1)])).ok).toBe(false)
  })

  it('saves shortly after a change and keeps deletions after a restart', async () => {
    const b = sockets.at(-1) as Socket
    await update(b, [element('1', 2, { isDeleted: true })])
    await sleep(SAVE_DELAY_MS * 4)
    const saved = await boardState()
    expect(saved.version).toBeGreaterThan(0)

    for (const socket of sockets) socket.disconnect()
    test = await test.restart()
    await listen()
    const state = await boardState()
    expect(state.elements.find((entry) => entry.id === '1')).toMatchObject({ isDeleted: true, version: 2 })

    // A stale client re-sending the old version cannot bring the element back.
    const c = await connect(anna)
    const joined = await join(c)
    expect(joined.ok && joined.elements.find((entry) => entry.id === '1')?.isDeleted).toBe(true)
    await update(c, [element('1', 1)])
    expect((await boardState()).elements.find((entry) => entry.id === '1')?.isDeleted).toBe(true)
  })

  it('saves pending changes on shutdown', async () => {
    const c = sockets.at(-1) as Socket
    await update(c, [element('4', 1)])
    test = await test.restart()
    await listen()
    expect((await boardState()).elements.some((entry) => entry.id === '4')).toBe(true)
  })

  it('restores a snapshot while another client is connected', async () => {
    const a = await connect(maik)
    const b = await connect(anna)
    await join(a)
    await join(b)
    const snapshot = await post(test.app, `/api/boards/${boardId}/snapshots`, {}, maik)
    expect(snapshot.statusCode).toBe(201)
    expect(snapshot.json()).toMatchObject({ reason: 'manual', createdByName: 'Maik' })
    const before = (await boardState()).elements

    await update(a, [element('5', 1), element('2', 7, { x: 500 })])
    await sleep(SAVE_DELAY_MS * 3)

    const received = next<{ elements: SceneElement[] }>(b, 'board:update')
    const restore = await post(test.app, `/api/boards/${boardId}/snapshots/${snapshot.json().id}/restore`, {}, anna)
    expect(restore.statusCode).toBe(204)
    const changed = (await received).elements
    const five = changed.find((entry) => entry.id === '5')
    const two = changed.find((entry) => entry.id === '2')
    expect(five).toMatchObject({ isDeleted: true, version: 2 })
    expect(two).toMatchObject({ x: 99 })
    expect(two?.version).toBeGreaterThan(7)

    const after = (await boardState()).elements.filter((entry) => !entry.isDeleted)
    expect(after.map((entry) => entry.id).sort()).toEqual(
      before
        .filter((entry) => !entry.isDeleted)
        .map((entry) => entry.id)
        .sort(),
    )
    const list = await test.app.inject({
      method: 'GET',
      url: `/api/boards/${boardId}/snapshots`,
      headers: { cookie: maik },
    })
    expect(list.json().map((entry: { reason: string }) => entry.reason)).toContain('before_restore')
  })

  it('stores board images and serves them safely', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    )
    const form = (fileId: string, data: Buffer, type: string) => {
      const boundary = '----wbfile'
      const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="fileId"\r\n\r\n${fileId}\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x"\r\nContent-Type: ${type}\r\n\r\n`,
      )
      return {
        payload: Buffer.concat([head, data, Buffer.from(`\r\n--${boundary}--\r\n`)]),
        headers: {
          cookie: maik,
          'sec-fetch-site': 'same-origin',
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      }
    }
    const fileId = 'a'.repeat(40)
    const upload = await test.app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/files`,
      ...form(fileId, png, 'image/png'),
    })
    expect(upload.statusCode).toBe(201)
    const again = await test.app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/files`,
      ...form(fileId, png, 'image/png'),
    })
    expect(again.statusCode).toBe(200)
    const html = await test.app.inject({
      method: 'POST',
      url: `/api/boards/${boardId}/files`,
      ...form('b'.repeat(40), Buffer.from('<html><script>alert(1)</script>'), 'image/png'),
    })
    expect(html.statusCode).toBe(415)

    const anonymous = await test.app.inject({ method: 'GET', url: `/api/files/${fileId}` })
    expect(anonymous.statusCode).toBe(401)
    const res = await test.app.inject({ method: 'GET', url: `/api/files/${fileId}`, headers: { cookie: anna } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['content-security-policy']).toBe("sandbox; default-src 'none'")
    expect(res.rawPayload.equals(png)).toBe(true)

    const svgId = 'c'.repeat(40)
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')
    await test.app.inject({ method: 'POST', url: `/api/boards/${boardId}/files`, ...form(svgId, svg, 'image/svg+xml') })
    const svgRes = await test.app.inject({ method: 'GET', url: `/api/files/${svgId}`, headers: { cookie: anna } })
    expect(svgRes.headers['content-disposition']).toMatch(/^attachment/)

    const a = sockets.at(-2) as Socket
    await update(a, [element('img', 1, { type: 'image', fileId })])
    expect((await boardState()).fileIds).toEqual([fileId])
  })
})
