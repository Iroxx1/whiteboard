import type { ItemDetail, SearchResult } from '@wb/shared'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { textFromTsv } from '../src/processors/ocr.ts'
import { hasTool, multipart, scannedPdf, textImage, tinyPdf } from './fixtures.ts'
import { setupAdmin, startApp, type TestApp } from './helpers.ts'

const HEADER = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'
const word = (block: number, par: number, line: number, conf: number, text: string) =>
  `5\t1\t${block}\t${par}\t${line}\t1\t0\t0\t10\t10\t${conf}\t${text}`

describe('ocr text from tesseract tsv', () => {
  it('joins words to lines and paragraphs', () => {
    const tsv = [
      HEADER,
      '1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t',
      word(1, 1, 1, 96, 'Rechnung'),
      word(1, 1, 1, 94, 'Nummer'),
      word(1, 1, 2, 91, '4711'),
      word(2, 1, 1, 90, 'Gartenmöbel'),
      word(2, 1, 1, 88, 'bezahlt'),
    ].join('\n')
    expect(textFromTsv(tsv)).toEqual({ text: 'Rechnung Nummer\n4711\n\nGartenmöbel bezahlt', confidence: 91.8 })
  })

  it('drops short or unsure results (photos without text)', () => {
    expect(textFromTsv([HEADER, word(1, 1, 1, 95, 'Hallo')].join('\n'))).toBeNull()
    const noise = [HEADER, ...Array.from({ length: 12 }, (_, i) => word(1, 1, i, 20, 'xk&lwq'))].join('\n')
    expect(textFromTsv(noise)).toBeNull()
  })
})

// Text recognition with the real tesseract (installed in CI and in the image, PLAN.md 5.10).
// Tesseract runs with one thread: allow up to a minute per test.
describe.runIf(hasTool('tesseract', ['--version']))('ocr jobs', { timeout: 60_000 }, () => {
  let test: TestApp
  let cookie: string

  beforeAll(async () => {
    test = await startApp({ env: { OCR_ENABLED: 'true' }, queue: { pollMs: 20 } })
    cookie = await setupAdmin(test)
  })

  afterAll(async () => {
    await test.app.close()
  })

  const upload = async (name: string, type: string, data: Buffer) => {
    const body = multipart({}, [{ name, type, data }])
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/items',
      headers: { cookie, 'sec-fetch-site': 'same-origin', 'content-type': body.contentType },
      payload: body.payload,
    })
    return res.json<{ items: { id: string }[] }>().items[0]?.id ?? ''
  }

  const recognised = async (id: string) => {
    for (let i = 0; i < 600; i++) {
      const item = (await test.app.inject({ url: `/api/items/${id}`, headers: { cookie } })).json<ItemDetail>()
      if (item.meta.ocrDone) return item
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('ocr did not finish')
  }

  it('recognises text in a screenshot and makes it searchable', async () => {
    const id = await upload(
      'screenshot.png',
      'image/png',
      await textImage(['Rechnung Nummer 4711', 'Lieferung der Gartenstühle', 'Bitte bis Freitag bezahlen']),
    )
    const item = await recognised(id)
    const text = item.texts.find((entry) => entry.kind === 'ocr')?.text ?? ''
    expect(text).toContain('Rechnung')
    expect(text).toContain('4711')
    const search = (await test.app.inject({ url: '/api/search?q=gartenst', headers: { cookie } })).json<SearchResult>()
    expect(search.items.map((hit) => hit.item.id)).toContain(id)
  })

  it('keeps no text for photos without writing', async () => {
    const photo = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 60, g: 140, b: 90 } },
    })
      .jpeg()
      .toBuffer()
    const item = await recognised(await upload('wiese.jpg', 'image/jpeg', photo))
    expect(item.texts.find((entry) => entry.kind === 'ocr')).toBeUndefined()
  })

  it.runIf(hasTool('pdftoppm', ['-v']))('recognises scanned PDFs, not PDFs with a text layer', async () => {
    const page = await sharp(await textImage(['Mietvertrag Wohnung Lindenallee', 'Kaution drei Monatsmieten']))
      .flatten({ background: '#fff' })
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true })
    const scan = await recognised(
      await upload('scan.pdf', 'application/pdf', scannedPdf(page.data, page.info.width, page.info.height)),
    )
    expect(scan.texts.find((entry) => entry.kind === 'ocr')?.text).toContain('Mietvertrag')

    const digital = await recognised(await upload('digital.pdf', 'application/pdf', tinyPdf()))
    expect(digital.texts.map((entry) => entry.kind)).toEqual(['pdf'])
  })
})
