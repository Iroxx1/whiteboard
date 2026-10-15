import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ItemDetail, SearchResult, SystemInfo } from '@wb/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanTranscript, transcribeTimeoutMs } from '../src/processors/transcribe.ts'
import { ffmpegClip, hasTool, multipart } from './fixtures.ts'
import { setupAdmin, startApp, type TestApp } from './helpers.ts'

describe('transcript helpers', () => {
  it('tidies whisper output', () => {
    expect(cleanTranscript(' Hallo\n Welt [BLANK_AUDIO]  ')).toBe('Hallo Welt')
    expect(cleanTranscript('[BLANK_AUDIO]')).toBe('')
  })

  it('uses 10 x duration + 60 s as timeout', () => {
    expect(transcribeTimeoutMs(60_000)).toBe(660_000)
    expect(transcribeTimeoutMs(undefined)).toBe(1_800_000)
  })
})

// Speech to text against a fake whisper.cpp server; the real one is measured on the server (PLAN.md 5.11).
describe.runIf(hasTool('ffmpeg'))('transcribe_audio job', { timeout: 30_000 }, () => {
  let whisper: http.Server
  let answer: { status: number; body: unknown } = { status: 200, body: { text: ' Das ist ein Wochenendeinkauf.\n' } }
  let received: { contentType: string; size: number }[] = []
  let test: TestApp
  let cookie: string

  beforeAll(async () => {
    whisper = http.createServer((request, response) => {
      if (request.method === 'GET') {
        response.end('<html>whisper</html>')
        return
      }
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        received.push({ contentType: request.headers['content-type'] ?? '', size: Buffer.concat(chunks).length })
        response.writeHead(answer.status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(answer.body))
      })
    })
    await new Promise<void>((resolve) => whisper.listen(0, '127.0.0.1', resolve))
    const { port } = whisper.address() as AddressInfo
    test = await startApp({
      env: { TRANSCRIBE_ENABLED: 'true', WHISPER_URL: `http://127.0.0.1:${port}/inference` },
      queue: { pollMs: 20, backoffMs: [20] },
    })
    cookie = await setupAdmin(test)
  })

  afterAll(async () => {
    await test.app.close()
    await new Promise((resolve) => whisper.close(resolve))
  })

  const upload = async () => {
    const body = multipart({}, [{ name: 'PTT-20261015.opus', type: 'audio/ogg', data: ffmpegClip('audio') }])
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/items',
      headers: { cookie, 'sec-fetch-site': 'same-origin', 'content-type': body.contentType },
      payload: body.payload,
    })
    return res.json<{ items: { id: string }[] }>().items[0]?.id ?? ''
  }

  const settled = async (id: string) => {
    for (let i = 0; i < 400; i++) {
      const item = (await test.app.inject({ url: `/api/items/${id}`, headers: { cookie } })).json<ItemDetail>()
      if (item.processing === 'ready' && item.meta.durationMs && !item.meta.transcribing) return item
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('transcription did not finish')
  }

  it('stores the transcript, shows a preview and makes it searchable', async () => {
    received = []
    const item = await settled(await upload())
    expect(received).toHaveLength(1)
    expect(received[0]?.contentType).toContain('multipart/form-data')
    expect(item.texts.find((entry) => entry.kind === 'transcript')?.text).toBe('Das ist ein Wochenendeinkauf.')
    expect(item.meta.transcriptPreview).toBe('Das ist ein Wochenendeinkauf.')
    const search = (await test.app.inject({ url: '/api/search?q=wochenend', headers: { cookie } })).json<SearchResult>()
    expect(search.items.map((hit) => hit.item.id)).toContain(item.id)
  })

  it('keeps the item usable when whisper fails', async () => {
    answer = { status: 500, body: { error: 'boom' } }
    const item = await settled(await upload())
    expect(item.processing).toBe('ready')
    expect(item.texts.find((entry) => entry.kind === 'transcript')).toBeUndefined()
    expect(item.meta.transcribing).toBe(false)
    answer = { status: 200, body: { text: 'x' } }
  })

  it('reports whisper on the health check and the system page', async () => {
    expect((await test.app.inject({ url: '/healthz' })).statusCode).toBe(200)
    const system = (await test.app.inject({ url: '/api/admin/system', headers: { cookie } })).json<SystemInfo>()
    expect(system.whisper).toEqual({ enabled: true, reachable: true, model: 'small-q5_1' })
    await new Promise((resolve) => whisper.close(resolve))
    expect((await test.app.inject({ url: '/healthz' })).statusCode).toBe(503)
    whisper.listen(0, '127.0.0.1')
  })
})
