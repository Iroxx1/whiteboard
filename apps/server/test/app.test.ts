import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { cacheControlFor } from '../src/routes/static.ts'
import { cookieOf, PUBLIC_URL, post, setupAdmin, startApp, type TestApp } from './helpers.ts'

describe('app basics', () => {
  let test: TestApp
  let cookie: string

  beforeAll(async () => {
    test = await startApp()
    cookie = await setupAdmin(test)
  })

  afterAll(async () => {
    await test.app.close()
  })

  it('answers the health check without details', async () => {
    const res = await test.app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('serves a manifest with a share target', async () => {
    const res = await test.app.inject({ method: 'GET', url: '/manifest.webmanifest' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/manifest+json')
    expect(res.headers['cache-control']).toBe('no-cache')
    const manifest = res.json()
    expect(manifest.display).toBe('standalone')
    expect(manifest.share_target).toMatchObject({ action: '/share-target', method: 'POST' })
  })

  it('no longer has the phase 0 access key', async () => {
    const res = await test.app.inject({ method: 'GET', url: '/zugang?key=x', headers: { accept: 'text/html' } })
    expect(res.body).toContain('shell')
    expect(res.cookies).toHaveLength(0)
  })

  it('serves the app shell for client routes and JSON 404 for the API', async () => {
    for (const method of ['GET', 'HEAD'] as const) {
      const root = await test.app.inject({ method, url: '/', headers: { accept: 'text/html' } })
      expect(root.statusCode).toBe(200)
      expect(root.headers['cache-control']).toBe('no-cache')
    }
    const page = await test.app.inject({ method: 'GET', url: '/b/123', headers: { accept: 'text/html' } })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('shell')

    const api = await test.app.inject({ method: 'GET', url: '/api/nope', headers: { cookie, accept: 'text/html' } })
    expect(api.statusCode).toBe(404)
    expect(api.json()).toEqual({ error: 'not found' })
  })

  it('caches hashed assets forever and the service worker never', async () => {
    const asset = await test.app.inject({ method: 'GET', url: '/assets/index-abc123.js' })
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    const sw = await test.app.inject({ method: 'GET', url: '/sw.js' })
    expect(sw.headers['cache-control']).toBe('no-cache')
    expect(sw.headers['x-content-type-options']).toBe('nosniff')
  })

  it('logs in after a restart with the same data directory', async () => {
    test = await test.restart()
    const res = await post(test.app, '/api/auth/login', {
      email: 'admin@example.test',
      password: 'korrekt-pferd-batterie',
    })
    expect(res.statusCode).toBe(200)
    cookie = cookieOf(res)
    expect(() => test.setupToken()).toThrow()
  })
})

describe('config', () => {
  it('strips a trailing slash from PUBLIC_URL', () => {
    const config = loadConfig({ NODE_ENV: 'test', PUBLIC_URL: `${PUBLIC_URL}/` })
    expect(config.PUBLIC_URL).toBe(PUBLIC_URL)
  })

  it('requires PUBLIC_URL', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/PUBLIC_URL/)
  })
})

describe('cacheControlFor', () => {
  it('maps paths to cache rules', () => {
    expect(cacheControlFor('index.html')).toBe('no-cache')
    expect(cacheControlFor('assets\\x-1.css')).toBe('public, max-age=31536000, immutable')
    expect(cacheControlFor('fonts/Nunito/a.woff2')).toBe('public, max-age=2592000')
    expect(cacheControlFor('icons/icon-192.png')).toBe('public, max-age=3600')
  })
})
