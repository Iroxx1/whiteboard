import { normalizeTags } from '@wb/shared'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { multipart } from './fixtures.ts'
import { post, setupAdmin, startApp, type TestApp } from './helpers.ts'

describe('normalizeTags', () => {
  it('trims, strips #, drops duplicates (any case) and too long tags', () => {
    expect(normalizeTags([' Urlaub ', '#urlaub', 'Familie', '', 'x'.repeat(25), 'A  B'])).toEqual([
      'Urlaub',
      'Familie',
      'A B',
    ])
  })

  it('keeps at most ten', () => {
    expect(normalizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(10)
  })
})

describe('board tags and preview image', () => {
  let test: TestApp
  let cookie: string

  beforeAll(async () => {
    test = await startApp()
    cookie = await setupAdmin(test)
  })

  afterAll(async () => {
    await test.app.close()
  })

  const headers = () => ({ cookie, 'sec-fetch-site': 'same-origin' })

  it('stores tags on create and update', async () => {
    const created = await post(
      test.app,
      '/api/boards',
      { name: 'Reise', tags: ['Urlaub', 'urlaub', 'Familie'] },
      cookie,
    )
    expect(created.json()).toMatchObject({ tags: ['Urlaub', 'Familie'], thumbAt: null })
    const id = created.json().id as string

    const patched = await test.app.inject({
      method: 'PATCH',
      url: `/api/boards/${id}`,
      headers: headers(),
      payload: { tags: ['Arbeit'] },
    })
    expect(patched.json().tags).toEqual(['Arbeit'])
    const list = await test.app.inject({ url: '/api/boards', headers: { cookie } })
    expect(list.json<{ id: string; tags: string[] }[]>().find((board) => board.id === id)?.tags).toEqual(['Arbeit'])
  })

  it('re-encodes an uploaded preview to a small WebP and serves it', async () => {
    const id = (await post(test.app, '/api/boards', { name: 'Vorschau' }, cookie)).json().id as string
    const png = await sharp({ create: { width: 1600, height: 1000, channels: 4, background: '#3366cc' } })
      .png()
      .toBuffer()
    const body = multipart({}, [{ name: 'preview.png', type: 'image/png', data: png }])
    const put = await test.app.inject({
      method: 'PUT',
      url: `/api/boards/${id}/thumbnail`,
      headers: { ...headers(), 'content-type': body.contentType },
      payload: body.payload,
    })
    expect(put.statusCode).toBe(200)
    const { thumbAt } = put.json<{ thumbAt: number }>()
    expect(thumbAt).toBeGreaterThan(0)

    const shown = await test.app.inject({ url: `/api/boards/${id}/thumbnail`, headers: { cookie } })
    expect(shown.statusCode).toBe(200)
    expect(shown.headers['content-type']).toBe('image/webp')
    const info = await sharp(shown.rawPayload).metadata()
    expect(info.format).toBe('webp')
    expect(info.width).toBeLessThanOrEqual(640)
    const board = await test.app.inject({ url: `/api/boards/${id}`, headers: { cookie } })
    expect(board.json().thumbAt).toBe(thumbAt)
  })

  it('rejects non-images, needs a login and an existing board', async () => {
    const id = (await post(test.app, '/api/boards', { name: 'Fehler' }, cookie)).json().id as string
    const junk = multipart({}, [{ name: 'x.png', type: 'image/png', data: Buffer.from('not an image') }])
    const bad = await test.app.inject({
      method: 'PUT',
      url: `/api/boards/${id}/thumbnail`,
      headers: { ...headers(), 'content-type': junk.contentType },
      payload: junk.payload,
    })
    expect(bad.statusCode).toBe(400)
    expect((await test.app.inject({ url: `/api/boards/${id}/thumbnail` })).statusCode).toBe(401)
    expect((await test.app.inject({ url: `/api/boards/${id}/thumbnail`, headers: { cookie } })).statusCode).toBe(404)
  })
})
