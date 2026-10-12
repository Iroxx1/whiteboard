import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cookieOf, inviteUser, PASSWORD, post, startApp, type TestApp } from './helpers.ts'

describe('accounts and sessions', () => {
  let test: TestApp
  let admin: string
  let member: string
  let memberId: string

  beforeAll(async () => {
    test = await startApp()
  })

  afterAll(async () => {
    await test.app.close()
  })

  const get = (url: string, cookie?: string) =>
    test.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })

  it('reports that setup is required and rejects anonymous API calls', async () => {
    expect((await get('/api/auth/status')).json()).toEqual({ setupRequired: true })
    expect((await get('/api/auth/me')).statusCode).toBe(401)
    expect((await get('/api/boards')).statusCode).toBe(401)
  })

  it('creates the admin only with the logged setup token and a good password', async () => {
    const base = { name: 'Maik', email: 'Admin@Example.test', password: PASSWORD }
    expect((await post(test.app, '/api/auth/setup', { ...base, token: 'wrong' })).statusCode).toBe(403)
    const weak = await post(test.app, '/api/auth/setup', { ...base, token: test.setupToken(), password: 'kurz' })
    expect(weak.statusCode).toBe(400)
    expect(weak.json()).toMatchObject({ error: 'weak_password', reason: 'too_short' })
    const common = await post(test.app, '/api/auth/setup', {
      ...base,
      token: test.setupToken(),
      password: 'Passwort123',
    })
    expect(common.json()).toMatchObject({ error: 'weak_password', reason: 'common' })

    const res = await post(test.app, '/api/auth/setup', { ...base, token: test.setupToken() })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ name: 'Maik', email: 'admin@example.test', role: 'admin', theme: 'system' })
    const cookie = res.cookies.find((entry) => entry.name === 'wb_session')
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
    expect(cookie?.maxAge).toBe(180 * 24 * 60 * 60)
    admin = cookieOf(res)

    expect((await get('/api/auth/status')).json()).toEqual({ setupRequired: false })
    const again = await post(test.app, '/api/auth/setup', {
      ...base,
      email: 'x@example.test',
      token: test.setupToken(),
    })
    expect(again.statusCode).toBe(403)
  })

  it('logs in with the right password only', async () => {
    const wrong = await post(test.app, '/api/auth/login', { email: 'admin@example.test', password: 'falsch-falsch' })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json()).toEqual({ error: 'invalid_credentials' })
    const unknown = await post(test.app, '/api/auth/login', { email: 'nobody@example.test', password: PASSWORD })
    expect(unknown.json()).toEqual({ error: 'invalid_credentials' })
    const ok = await post(test.app, '/api/auth/login', { email: ' ADMIN@example.test ', password: PASSWORD })
    expect(ok.statusCode).toBe(200)
    expect((await get('/api/auth/me', cookieOf(ok))).json().name).toBe('Maik')
  })

  it('locks the login after 5 failures per IP and e-mail', async () => {
    const attempt = (password: string) => post(test.app, '/api/auth/login', { email: 'locked@example.test', password })
    for (let i = 0; i < 5; i++) expect((await attempt('falsch-falsch')).statusCode).toBe(401)
    const locked = await attempt(PASSWORD)
    expect(locked.statusCode).toBe(429)
    expect(locked.json().retryAfterSeconds).toBeGreaterThan(0)
  })

  it('invites a member with a one-time link', async () => {
    const invite = await post(test.app, '/api/admin/invites', { role: 'member' }, admin)
    expect(invite.statusCode).toBe(200)
    const { url, expiresAt } = invite.json<{ url: string; expiresAt: number }>()
    expect(url).toMatch(/^https:\/\/board\.example\.test\/invite\/[A-Za-z0-9_-]{43}$/)
    expect(expiresAt - Date.now()).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000)
    const token = url.split('/').pop()

    expect((await get(`/api/invites/${token}`)).json()).toMatchObject({ role: 'member' })
    const taken = await post(test.app, `/api/invites/${token}`, {
      name: 'X',
      email: 'admin@example.test',
      password: PASSWORD,
    })
    expect(taken.statusCode).toBe(409)

    const res = await post(test.app, `/api/invites/${token}`, {
      name: 'Anna',
      email: 'anna@example.test',
      password: PASSWORD,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ name: 'Anna', role: 'member' })
    member = cookieOf(res)
    memberId = res.json().id

    expect((await get(`/api/invites/${token}`)).statusCode).toBe(404)
    const reuse = await post(test.app, `/api/invites/${token}`, {
      name: 'B',
      email: 'b@example.test',
      password: PASSWORD,
    })
    expect(reuse.statusCode).toBe(404)
  })

  it('keeps the admin area for admins', async () => {
    expect((await post(test.app, '/api/admin/invites', {}, member)).statusCode).toBe(403)
    expect((await get('/api/admin/users', member)).statusCode).toBe(403)
    const users = (await get('/api/admin/users', admin)).json()
    expect(users.map((user: { name: string }) => user.name)).toEqual(['Anna', 'Maik'])
    expect(JSON.stringify(users)).not.toContain('password')
  })

  it('updates name and theme', async () => {
    const res = await test.app.inject({
      method: 'PUT',
      url: '/api/me',
      headers: { cookie: member, 'sec-fetch-site': 'same-origin' },
      payload: { theme: 'dark', name: ' Anna B. ' },
    })
    expect(res.json()).toMatchObject({ theme: 'dark', name: 'Anna B.' })
    expect((await get('/api/auth/me', member)).json()).toMatchObject({ theme: 'dark', name: 'Anna B.' })
  })

  it('lists and revokes own sessions', async () => {
    const second = cookieOf(await post(test.app, '/api/auth/login', { email: 'anna@example.test', password: PASSWORD }))
    const sessions = (await get('/api/me/sessions', member)).json<{ id: string; current: boolean }[]>()
    expect(sessions).toHaveLength(2)
    const other = sessions.find((session) => !session.current)
    const del = await test.app.inject({
      method: 'DELETE',
      url: `/api/me/sessions/${other?.id}`,
      headers: { cookie: member, 'sec-fetch-site': 'same-origin' },
    })
    expect(del.statusCode).toBe(204)
    expect((await get('/api/auth/me', second)).statusCode).toBe(401)
    expect((await get('/api/auth/me', member)).statusCode).toBe(200)
  })

  it('changes the password and signs out other devices', async () => {
    const other = cookieOf(await post(test.app, '/api/auth/login', { email: 'anna@example.test', password: PASSWORD }))
    const put = (payload: object) =>
      test.app.inject({
        method: 'PUT',
        url: '/api/me/password',
        headers: { cookie: member, 'sec-fetch-site': 'same-origin' },
        payload,
      })
    expect((await put({ currentPassword: 'falsch-falsch', newPassword: 'neues-langes-passwort' })).json()).toEqual({
      error: 'wrong_password',
    })
    expect((await put({ currentPassword: PASSWORD, newPassword: 'neues-langes-passwort' })).statusCode).toBe(204)
    expect((await get('/api/auth/me', other)).statusCode).toBe(401)
    expect((await get('/api/auth/me', member)).statusCode).toBe(200)
  })

  it('resets a password with an admin link', async () => {
    const link = (await post(test.app, `/api/admin/users/${memberId}/reset-link`, {}, admin)).json<{ url: string }>()
    expect(link.url).toMatch(/\/reset\/[A-Za-z0-9_-]{43}$/)
    const token = link.url.split('/').pop()
    const res = await post(test.app, `/api/auth/reset/${token}`, { password: 'ganz-neues-passwort' })
    expect(res.statusCode).toBe(200)
    expect((await get('/api/auth/me', member)).statusCode).toBe(401)
    member = cookieOf(res)
    expect((await post(test.app, `/api/auth/reset/${token}`, { password: 'noch-ein-passwort' })).statusCode).toBe(404)
    const login = await post(test.app, '/api/auth/login', {
      email: 'anna@example.test',
      password: 'ganz-neues-passwort',
    })
    expect(login.statusCode).toBe(200)
  })

  it('disables users and protects the last admin', async () => {
    const patch = (id: string, payload: object, cookie: string) =>
      test.app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${id}`,
        headers: { cookie, 'sec-fetch-site': 'same-origin' },
        payload,
      })
    const adminId = (await get('/api/auth/me', admin)).json().id
    expect((await patch(adminId, { disabled: true }, admin)).statusCode).toBe(403)

    const res = await patch(memberId, { disabled: true }, admin)
    expect(res.json().disabledAt).toBeTypeOf('number')
    expect((await get('/api/auth/me', member)).statusCode).toBe(401)
    const login = await post(test.app, '/api/auth/login', {
      email: 'anna@example.test',
      password: 'ganz-neues-passwort',
    })
    expect(login.statusCode).toBe(401)

    await patch(memberId, { disabled: false, role: 'admin' }, admin)
    const anna = cookieOf(
      await post(test.app, '/api/auth/login', { email: 'anna@example.test', password: 'ganz-neues-passwort' }),
    )
    expect((await patch(adminId, { role: 'member' }, anna)).statusCode).toBe(200)
    // Maik is a member now: the role is read from the database on every request.
    expect((await patch(memberId, { role: 'member' }, admin)).statusCode).toBe(403)
    expect((await patch(adminId, { role: 'admin' }, anna)).statusCode).toBe(200)
    expect((await patch(memberId, { disabled: true }, admin)).statusCode).toBe(200)
    expect((await patch(adminId, { disabled: true }, anna)).statusCode).toBe(401)
  })

  it('logs out', async () => {
    const res = await post(test.app, '/api/auth/logout', {}, admin)
    expect(res.statusCode).toBe(204)
    expect((await get('/api/auth/me', admin)).statusCode).toBe(401)
  })

  it('second invite user helper works', async () => {
    const fresh = await startApp()
    const adminCookie = cookieOf(
      await post(fresh.app, '/api/auth/setup', {
        token: fresh.setupToken(),
        name: 'A',
        email: 'a@example.test',
        password: PASSWORD,
      }),
    )
    const cookie = await inviteUser(fresh, adminCookie, 'B', 'b@example.test')
    expect(cookie).toMatch(/^wb_session=/)
    await fresh.app.close()
  })
})
