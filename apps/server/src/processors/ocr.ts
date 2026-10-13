import fs from 'node:fs'
import path from 'node:path'
import { ulid } from '@wb/shared'
import heicConvert from 'heic-convert'
import sharp from 'sharp'
import type { ItemService } from '../items/service.ts'
import { runTool } from '../lib/exec.ts'

/** Images are scaled down to this before recognition (PLAN.md 5.10). */
const OCR_MAX = 2500
const TIMEOUT_MS = 120_000
/** Shorter results are noise (PLAN.md 5.10: at least 20 characters). */
const MIN_CHARS = 20
/** Photos without text give random letters with low confidence; such results are dropped. */
const MIN_CONFIDENCE = 55
/** PDFs with less text per page are treated as scans (PLAN.md 5.10). */
const SCAN_CHARS_PER_PAGE = 50
const PDF_PAGES = 10
const OCR_TEXT_MAX = 200_000

export type OcrContext = { items: ItemService; tmpDir: string; langs: string }

/** One CPU thread for Tesseract: recognition may take longer, the app stays responsive. */
const TESSERACT_ENV = { OMP_THREAD_LIMIT: '1' }

/**
 * Text from Tesseract's TSV output: words joined to lines, paragraphs separated by an empty line.
 * Returns null when the text is too short or the mean word confidence too low.
 */
export function textFromTsv(tsv: string): { text: string; confidence: number } | null {
  const lines = new Map<string, string[]>()
  const paragraphs: string[] = []
  let confidenceSum = 0
  let words = 0
  for (const row of tsv.split('\n').slice(1)) {
    const cols = row.split('\t')
    if (cols.length < 12 || cols[0] !== '5') continue
    const word = (cols[11] ?? '').trim()
    const confidence = Number(cols[10])
    if (!word || !(confidence >= 0)) continue
    const paragraph = `${cols[1]}.${cols[2]}.${cols[3]}`
    const line = `${paragraph}.${cols[4]}`
    if (!lines.has(line)) {
      lines.set(line, [])
      if (paragraphs.at(-1) !== paragraph) paragraphs.push(paragraph)
    }
    lines.get(line)?.push(word)
    confidenceSum += confidence
    words += 1
  }
  if (words === 0) return null
  const confidence = confidenceSum / words
  const text = paragraphs
    .map((paragraph) =>
      [...lines.entries()]
        .filter(([key]) => key.startsWith(`${paragraph}.`))
        .map(([, list]) => list.join(' '))
        .join('\n'),
    )
    .join('\n\n')
    .trim()
  const letters = text.replace(/[^\p{L}\p{N}]/gu, '').length
  if (letters < MIN_CHARS || confidence < MIN_CONFIDENCE) return null
  return { text, confidence }
}

async function tesseract(ctx: OcrContext, image: string): Promise<string | null> {
  const tsv = await runTool('tesseract', [image, 'stdout', '-l', ctx.langs, '--psm', '3', 'tsv'], {
    timeoutMs: TIMEOUT_MS,
    env: TESSERACT_ENV,
  })
  return textFromTsv(tsv.toString('utf8'))?.text ?? null
}

async function withTmpDir<T>(ctx: OcrContext, run: (dir: string) => Promise<T>): Promise<T> {
  const dir = path.join(ctx.tmpDir, `ocr-${ulid()}`)
  fs.mkdirSync(dir, { recursive: true })
  try {
    return await run(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function finish(ctx: OcrContext, itemId: string, text: string | null) {
  if (text) ctx.items.setText(itemId, 'ocr', text.slice(0, OCR_TEXT_MAX))
  ctx.items.patchMeta(itemId, { ocrDone: true })
}

/** `ocr_image` (PLAN.md 5.10): photo or screenshot → "Erkannter Text". */
export async function ocrImage(ctx: OcrContext, itemId: string) {
  const source = ctx.items.assetPath(itemId, 'original')
  if (!source) return
  let input = fs.readFileSync(source.file)
  if (source.mime === 'image/heic' || source.mime === 'image/heif') {
    input = Buffer.from(await heicConvert({ buffer: input, format: 'JPEG', quality: 0.9 }))
  }
  const text = await withTmpDir(ctx, async (dir) => {
    const file = path.join(dir, 'ocr.png')
    await sharp(input, { failOn: 'none', limitInputPixels: 120_000_000 })
      .rotate()
      .resize({ width: OCR_MAX, height: OCR_MAX, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .png()
      .toFile(file)
    return tesseract(ctx, file)
  })
  finish(ctx, itemId, text)
}

/** `ocr_pdf` (PLAN.md 5.10): only scans (little embedded text), first 10 pages at 150 dpi. */
export async function ocrPdf(ctx: OcrContext, itemId: string, pdfText: string, pageCount: number) {
  if (pdfText.replace(/\s+/g, '').length >= SCAN_CHARS_PER_PAGE * Math.max(1, Math.min(pageCount, PDF_PAGES))) {
    ctx.items.patchMeta(itemId, { ocrDone: true })
    return
  }
  const source = ctx.items.assetPath(itemId, 'original')
  if (!source) return
  const text = await withTmpDir(ctx, async (dir) => {
    await runTool(
      'pdftoppm',
      ['-r', '150', '-gray', '-png', '-f', '1', '-l', String(PDF_PAGES), source.file, path.join(dir, 'page')],
      { timeoutMs: TIMEOUT_MS },
    )
    const pages = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.png'))
      .sort()
    const texts: string[] = []
    for (const page of pages) {
      const pageText = await tesseract(ctx, path.join(dir, page))
      if (pageText) texts.push(pageText)
    }
    return texts.join('\n\n')
  })
  finish(ctx, itemId, text || null)
}
