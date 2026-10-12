import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { post, setupAdmin, startApp, type TestApp } from './helpers.ts'

describe('boards', () => {
  let test: TestApp
  let cookie: string

  beforeAll(async () => {
    test = await startApp()
    cookie = await setupAdmin(test)
  })

  afterAll(async () => {
    await test.app.close()
  })

  const get = (url: string) => test.app.inject({ method: 'GET', url, headers: { cookie } })
  const send = (method: 'PATCH' | 'DELETE', url: string, payload?: object) =>
    test.app.inject({
      method,
      url,
      headers: { cookie, 'sec-fetch-site': 'same-origin' },
      ...(payload ? { payload } : {}),
    })

  it('creates boards with a hashtag derived from the name', async () => {
    const res = await post(test.app, '/api/boards', { name: 'Urlaub Italien' }, cookie)
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ name: 'Urlaub Italien', hashtag: 'urlaubitalien', updatedByName: 'Maik' })

    const own = await post(test.app, '/api/boards', { name: 'Küche', hashtag: '#Küche-Plan' }, cookie)
    expect(own.json().hashtag).toBe('kuecheplan')

    const taken = await post(test.app, '/api/boards', { name: 'Urlaub', hashtag: 'UrlaubItalien' }, cookie)
    expect(taken.statusCode).toBe(409)
    expect(taken.json()).toEqual({ error: 'hashtag_taken' })

    const empty = await post(test.app, '/api/boards', { name: '📥' }, cookie)
    expect(empty.statusCode).toBe(400)
  })

  it('lists, renames and changes the hashtag', async () => {
    const boards = (await get('/api/boards')).json<{ id: string; name: string }[]>()
    expect(boards.map((board) => board.name)).toEqual(['Küche', 'Urlaub Italien'])
    const id = boards[1]?.id
    const renamed = await send('PATCH', `/api/boards/${id}`, { name: 'Urlaub 2027', hashtag: 'urlaub' })
    expect(renamed.json()).toMatchObject({ name: 'Urlaub 2027', hashtag: 'urlaub' })
    expect((await send('PATCH', `/api/boards/${id}`, { hashtag: 'kuecheplan' })).statusCode).toBe(409)
    expect((await send('PATCH', '/api/boards/unknown', { name: 'x' })).statusCode).toBe(404)

    const detail = (await get(`/api/boards/${id}`)).json()
    expect(detail).toMatchObject({ name: 'Urlaub 2027', version: 0, elements: [], appState: {}, fileIds: [] })
  })

  it('moves boards to the trash and restores them', async () => {
    const [board] = (await get('/api/boards')).json<{ id: string }[]>()
    expect((await send('DELETE', `/api/boards/${board?.id}`)).statusCode).toBe(204)
    expect((await get(`/api/boards/${board?.id}`)).statusCode).toBe(404)
    expect((await get('/api/boards')).json()).toHaveLength(1)
    const trash = (await get('/api/boards?trash=1')).json()
    expect(trash).toHaveLength(1)
    expect(trash[0].deletedAt).toBeTypeOf('number')

    const restored = await post(test.app, `/api/boards/${board?.id}/restore`, {}, cookie)
    expect(restored.json().deletedAt).toBeNull()
    expect((await get('/api/boards')).json()).toHaveLength(2)
  })
})
