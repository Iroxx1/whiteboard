import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { E2E_PORT } from '../playwright.config.ts'

/** Starts the built server on a fresh data directory and reads the setup link from its log. */
export default async function globalSetup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-e2e-'))
  const server: ChildProcess = spawn(process.execPath, ['apps/server/dist/index.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(E2E_PORT),
      HOST: '127.0.0.1',
      PUBLIC_URL: `http://localhost:${E2E_PORT}`,
      DATA_DIR: dataDir,
      LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })

  const setupUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not log a setup link')), 20_000)
    let buffer = ''
    server.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      for (const line of buffer.split('\n')) {
        try {
          const url = (JSON.parse(line) as { setupUrl?: string }).setupUrl
          if (url) {
            clearTimeout(timer)
            resolve(url)
          }
        } catch {
          // incomplete line
        }
      }
    })
    server.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
  })
  // Wait until it accepts requests.
  for (let i = 0; i < 50; i++) {
    const ok = await fetch(`http://localhost:${E2E_PORT}/healthz`).then(
      (res) => res.ok,
      () => false,
    )
    if (ok) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  process.env.WB_E2E_SETUP_URL = setupUrl

  return async () => {
    const exited = new Promise((resolve) => server.once('exit', resolve))
    server.kill('SIGTERM')
    await exited
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
