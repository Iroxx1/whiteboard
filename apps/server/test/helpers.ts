import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { type BuildOptions, buildApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

export const PUBLIC_URL = 'https://board.example.test'
export const ORIGIN_HEADERS = { 'sec-fetch-site': 'same-origin' }
export const PASSWORD = 'korrekt-pferd-batterie'

export function makeWebDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-web-'))
  fs.mkdirSync(path.join(dir, 'assets'))
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>shell</title>')
  fs.writeFileSync(path.join(dir, 'sw.js'), 'self.addEventListener("fetch", () => {})')
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)')
  return dir
}

export type TestApp = {
  app: FastifyInstance
  dataDir: string
  /** The setup link token from the log (only while no account exists). */
  setupToken: () => string
  restart: () => Promise<TestApp>
}

export async function startApp(
  options: BuildOptions & { dataDir?: string; env?: Record<string, string> } = {},
): Promise<TestApp> {
  const dataDir = options.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'wb-data-'))
  const lines: string[] = []
  const config = loadConfig({
    NODE_ENV: 'production',
    LOG_LEVEL: 'info',
    PUBLIC_URL,
    DATA_DIR: dataDir,
    WEB_DIST: makeWebDist(),
    ...options.env,
  })
  const app = await buildApp(config, { ...options, logStream: { write: (line) => void lines.push(line) } })
  await app.ready()
  return {
    app,
    dataDir,
    setupToken() {
      for (const line of lines) {
        const url = (JSON.parse(line) as { setupUrl?: string }).setupUrl
        if (url) return new URL(url).searchParams.get('token') ?? ''
      }
      throw new Error('no setup link logged')
    },
    async restart() {
      await app.close()
      return startApp({ ...options, dataDir })
    },
  }
}

export function cookieOf(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((entry) => entry.name === 'wb_session')
  if (!cookie) throw new Error(`no session cookie (status ${res.statusCode}: ${res.body})`)
  return `wb_session=${cookie.value}`
}

export async function post(app: FastifyInstance, url: string, payload: unknown, cookie?: string) {
  return app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers: { ...ORIGIN_HEADERS, ...(cookie ? { cookie } : {}) },
  })
}

export async function setupAdmin(test: TestApp, name = 'Maik', email = 'admin@example.test') {
  const res = await post(test.app, '/api/auth/setup', { token: test.setupToken(), name, email, password: PASSWORD })
  return cookieOf(res)
}

/** Creates an invite as admin and accepts it; returns the new user's cookie. */
export async function inviteUser(test: TestApp, adminCookie: string, name: string, email: string) {
  const invite = await post(test.app, '/api/admin/invites', { role: 'member' }, adminCookie)
  const token = new URL(invite.json<{ url: string }>().url).pathname.split('/').pop()
  const res = await post(test.app, `/api/invites/${token}`, { name, email, password: PASSWORD })
  return cookieOf(res)
}
