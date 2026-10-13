import { afterEach, describe, expect, it, vi } from 'vitest'
// Plain JavaScript (pasted into the Cloudflare dashboard), see infra/cloudflare-email-worker.
import worker from '../../../infra/cloudflare-email-worker/src/index.js'

type Fake = {
  from: string
  to: string
  raw: ReadableStream
  rejected: string | null
  forwarded: string | null
  setReject: (reason: string) => void
  forward: (to: string) => Promise<void>
}

function fakeMessage(): Fake {
  const message: Fake = {
    from: 'maik@gmail.com',
    to: 'board@example.de',
    raw: new Response('From: maik@gmail.com\r\n\r\nhallo').body as ReadableStream,
    rejected: null,
    forwarded: null,
    setReject: (reason) => {
      message.rejected = reason
    },
    forward: async (to) => {
      message.forwarded = to
    },
  }
  return message
}

const env = {
  INGEST_URL: 'https://board.example.de/api/ingest/email',
  INGEST_TOKEN: 't',
  FALLBACK_FORWARD: 'me@gmail.com',
}

// Email worker (PLAN.md 5.8): accepted, refused, and forwarded when the server is not reachable.
describe('cloudflare email worker', () => {
  afterEach(() => vi.unstubAllGlobals())

  const run = async (respond: () => Promise<Response>) => {
    const fetch = vi.fn(respond)
    vi.stubGlobal('fetch', fetch)
    const message = fakeMessage()
    await worker.email(message, env)
    return { message, fetch }
  }

  it('posts the raw mail with the token', async () => {
    const { message, fetch } = await run(async () => new Response(null, { status: 202 }))
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(env.INGEST_URL)
    expect(init.headers).toMatchObject({ Authorization: 'Bearer t', 'Content-Type': 'message/rfc822' })
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toContain('hallo')
    expect(message.rejected).toBeNull()
    expect(message.forwarded).toBeNull()
  })

  it('refuses mails the server rejects', async () => {
    const { message } = await run(async () => new Response(null, { status: 403 }))
    expect(message.rejected).toBe('Absender nicht berechtigt')
    expect(message.forwarded).toBeNull()
  })

  it('forwards to Gmail when the server is down or answers with an error', async () => {
    expect((await run(async () => Promise.reject(new Error('offline')))).message.forwarded).toBe('me@gmail.com')
    expect((await run(async () => new Response(null, { status: 502 }))).message.forwarded).toBe('me@gmail.com')
    expect((await run(async () => new Response(null, { status: 401 }))).message.forwarded).toBe('me@gmail.com')
  })
})
