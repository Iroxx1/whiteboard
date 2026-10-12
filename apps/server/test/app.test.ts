import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { cacheControlFor } from '../src/routes/static.ts'

const ACCESS_KEY = 'test-access-key-0123456789abcdef'
const PUBLIC_URL = 'https://board.example.test'

function makeWebDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-web-'))
  fs.mkdirSync(path.join(dir, 'assets'))
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>shell</title>')
  fs.writeFileSync(path.join(dir, 'sw.js'), 'self.addEventListener("fetch", () => {})')
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)')
  return dir
}

function multipart(fields: Record<string, string>, files: { name: string; type: string; content: string }[]) {
  const boundary = '----wbtest'
  const chunks: string[] = []
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
  }
  for (const file of files) {
    chunks.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\n` +
        `Content-Type: ${file.type}\r\n\r\n${file.content}\r\n`,
    )
  }
  chunks.push(`--${boundary}--\r\n`)
  return { payload: chunks.join(''), contentType: `multipart/form-data; boundary=${boundary}` }
}

describe('app (production config)', () => {
  let app: FastifyInstance
  let cookie: string

  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      PUBLIC_URL,
      DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'wb-data-')),
      WEB_DIST: makeWebDist(),
      SPIKE_ACCESS_KEY: ACCESS_KEY,
    })
    app = await buildApp(config)
    const res = await app.inject({ method: 'GET', url: `/zugang?key=${ACCESS_KEY}` })
    const setCookie = res.cookies.find((entry) => entry.name === 'wb_spike')
    if (!setCookie) throw new Error('no access cookie')
    cookie = `wb_spike=${setCookie.value}`
  })

  afterAll(async () => {
    await app.close()
  })

  it('answers the health check without details', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('serves a manifest with a share target', async () => {
    const res = await app.inject({ method: 'GET', url: '/manifest.webmanifest' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/manifest+json')
    expect(res.headers['cache-control']).toBe('no-cache')
    const manifest = res.json()
    expect(manifest.display).toBe('standalone')
    expect(manifest.share_target).toMatchObject({ action: '/share-target', method: 'POST' })
  })

  it('sets a secure HttpOnly cookie only for the right key', async () => {
    const ok = await app.inject({ method: 'GET', url: `/zugang?key=${ACCESS_KEY}` })
    expect(ok.statusCode).toBe(303)
    const setCookie = ok.cookies.find((entry) => entry.name === 'wb_spike')
    expect(setCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })

    const bad = await app.inject({ method: 'GET', url: '/zugang?key=wrong' })
    expect(bad.statusCode).toBe(403)
    expect(bad.cookies).toHaveLength(0)
  })

  it('protects the debug endpoints', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/debug/share' })
    expect(res.statusCode).toBe(401)
    const access = await app.inject({ method: 'GET', url: '/api/debug/access' })
    expect(access.json()).toEqual({ ok: false })
  })

  it('rejects cross-site POSTs', async () => {
    const body = multipart({ title: 'x' }, [])
    const res = await app.inject({
      method: 'POST',
      url: '/api/debug/share',
      headers: { cookie, 'content-type': body.contentType, 'sec-fetch-site': 'cross-site' },
      payload: body.payload,
    })
    expect(res.statusCode).toBe(403)
  })

  it('records shared fields and files without keeping file contents', async () => {
    const body = multipart({ title: 'Seite', text: 'Schau mal https://example.org', via: 'service-worker' }, [
      { name: 'foto.jpg', type: 'image/jpeg', content: 'abcdef' },
      { name: 'sprachnachricht.opus', type: 'audio/ogg', content: '1234' },
    ])
    const res = await app.inject({
      method: 'POST',
      url: '/api/debug/share',
      headers: { cookie, 'content-type': body.contentType, 'sec-fetch-site': 'same-origin' },
      payload: body.payload,
    })
    expect(res.statusCode).toBe(200)
    const report = res.json()
    expect(report).toMatchObject({
      via: 'service-worker',
      title: 'Seite',
      text: 'Schau mal https://example.org',
      url: null,
      files: [
        { name: 'foto.jpg', type: 'image/jpeg', size: 6 },
        { name: 'sprachnachricht.opus', type: 'audio/ogg', size: 4 },
      ],
    })

    const one = await app.inject({ method: 'GET', url: `/api/debug/share/${report.id}`, headers: { cookie } })
    expect(one.json().id).toBe(report.id)
  })

  it('handles OS-initiated share-target posts as a fallback', async () => {
    const body = multipart({ url: 'https://example.org' }, [])
    const res = await app.inject({
      method: 'POST',
      url: '/share-target',
      headers: { cookie, 'content-type': body.contentType, 'sec-fetch-site': 'none' },
      payload: body.payload,
    })
    expect(res.statusCode).toBe(303)
    expect(res.headers.location).toMatch(/^\/share\?report=[0-9A-Z]{26}$/)

    const anonymous = await app.inject({
      method: 'POST',
      url: '/share-target',
      headers: { 'content-type': body.contentType, 'sec-fetch-site': 'none' },
      payload: body.payload,
    })
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.headers['content-type']).toContain('text/html')
  })

  it('serves the app shell for client routes and JSON 404 for the API', async () => {
    for (const method of ['GET', 'HEAD'] as const) {
      const root = await app.inject({ method, url: '/', headers: { accept: 'text/html' } })
      expect(root.statusCode).toBe(200)
      expect(root.headers['cache-control']).toBe('no-cache')
    }

    const page = await app.inject({ method: 'GET', url: '/share?id=1', headers: { accept: 'text/html' } })
    expect(page.statusCode).toBe(200)
    expect(page.headers['cache-control']).toBe('no-cache')
    expect(page.body).toContain('shell')

    const api = await app.inject({ method: 'GET', url: '/api/nope', headers: { accept: 'text/html' } })
    expect(api.statusCode).toBe(404)
    expect(api.json()).toEqual({ error: 'not found' })
  })

  it('caches hashed assets forever and the service worker never', async () => {
    const asset = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' })
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    const sw = await app.inject({ method: 'GET', url: '/sw.js' })
    expect(sw.headers['cache-control']).toBe('no-cache')
    expect(sw.headers['x-content-type-options']).toBe('nosniff')
  })
})

describe('config', () => {
  it('requires an access key in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', PUBLIC_URL })).toThrow(/SPIKE_ACCESS_KEY/)
  })

  it('strips a trailing slash from PUBLIC_URL', () => {
    const config = loadConfig({ NODE_ENV: 'test', PUBLIC_URL: `${PUBLIC_URL}/` })
    expect(config.PUBLIC_URL).toBe(PUBLIC_URL)
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
