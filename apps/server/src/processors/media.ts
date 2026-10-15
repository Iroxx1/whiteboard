import fs from 'node:fs'
import path from 'node:path'
import { ulid } from '@wb/shared'
import heicConvert from 'heic-convert'
import sharp from 'sharp'
import type { ItemService } from '../items/service.ts'
import { runTool } from '../lib/exec.ts'
import { isTextMime } from '../lib/mime.ts'

// Weak hardware: one libvips thread, see also UV_THREADPOOL_SIZE=2 (PLAN.md 5.5).
sharp.concurrency(1)

const DISPLAY_MAX = 1600
const THUMB_MAX = 400
const PREVIEW_MAX = 800
const MAX_PIXELS = 120_000_000
const TEXT_PREVIEW_BYTES = 2 * 1024
const TEXT_INDEX_BYTES = 200 * 1024
const PDF_TEXT_BYTES = 1024 * 1024

export type MediaContext = { items: ItemService; tmpDir: string }

function original(ctx: MediaContext, itemId: string) {
  const asset = ctx.items.assetPath(itemId, 'original')
  if (!asset) throw new Error('original file missing')
  return asset
}

async function webp(input: Buffer | string, max: number) {
  return sharp(input, { failOn: 'none', limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true })
}

/** EXIF rotation, display version (≤ 1600 px) and thumbnail (400 px) without metadata; HEIC → JPEG first. */
export async function processImage(ctx: MediaContext, itemId: string) {
  const source = original(ctx, itemId)
  let input = fs.readFileSync(source.file)
  if (source.mime === 'image/heic' || source.mime === 'image/heif') {
    input = Buffer.from(await heicConvert({ buffer: input, format: 'JPEG', quality: 0.9 }))
  }
  const display = await webp(input, DISPLAY_MAX)
  const thumb = await webp(input, THUMB_MAX)
  ctx.items.addAssetFromBuffer(itemId, 'display', display.data, 'image/webp', 'display.webp', display.info)
  ctx.items.addAssetFromBuffer(itemId, 'thumb', thumb.data, 'image/webp', 'thumb.webp', thumb.info)
  ctx.items.setProcessed(itemId, { meta: { width: display.info.width, height: display.info.height } })
}

function withTmpDir<T>(ctx: MediaContext, run: (dir: string) => Promise<T>): Promise<T> {
  const dir = path.join(ctx.tmpDir, `job-${ulid()}`)
  fs.mkdirSync(dir, { recursive: true })
  return run(dir).finally(() => fs.rmSync(dir, { recursive: true, force: true }))
}

/** Page count, preview of page 1 and the text (PLAN.md 5.5). */
export async function processPdf(ctx: MediaContext, itemId: string) {
  const source = original(ctx, itemId)
  const info = (await runTool('pdfinfo', [source.file], { timeoutMs: 30_000 })).toString('utf8')
  const pageCount = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1] ?? 0) || undefined
  await withTmpDir(ctx, async (dir) => {
    const prefix = path.join(dir, 'page')
    await runTool(
      'pdftoppm',
      ['-png', '-f', '1', '-l', '1', '-singlefile', '-scale-to', String(PREVIEW_MAX), source.file, prefix],
      {
        timeoutMs: 60_000,
      },
    )
    const preview = await webp(`${prefix}.png`, PREVIEW_MAX)
    ctx.items.addAssetFromBuffer(itemId, 'page1', preview.data, 'image/webp', 'page1.webp', preview.info)
  })
  const text = (
    await runTool('pdftotext', ['-enc', 'UTF-8', source.file, '-'], { timeoutMs: 60_000, maxBuffer: 32 * 1024 * 1024 })
  )
    .toString('utf8')
    .slice(0, PDF_TEXT_BYTES)
    .trim()
  if (text) ctx.items.setText(itemId, 'pdf', text)
  ctx.items.setProcessed(itemId, { meta: { ...(pageCount ? { pageCount } : {}) } })
}

type Probe = { format?: { duration?: string }; streams?: { width?: number; height?: number }[] }

async function probe(file: string, video: boolean): Promise<Probe> {
  const args = [
    '-v',
    'error',
    '-show_entries',
    video ? 'format=duration:stream=width,height' : 'format=duration',
    '-of',
    'json',
  ]
  if (video) args.push('-select_streams', 'v:0')
  return JSON.parse((await runTool('ffprobe', [...args, file], { timeoutMs: 30_000 })).toString('utf8')) as Probe
}

const durationOf = (result: Probe) => {
  const seconds = Number(result.format?.duration)
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined
}

export async function processAudio(ctx: MediaContext, itemId: string, transcribing = false) {
  const durationMs = durationOf(await probe(original(ctx, itemId).file, false))
  ctx.items.setProcessed(itemId, {
    meta: { ...(durationMs ? { durationMs } : {}), ...(transcribing ? { transcribing: true } : {}) },
  })
}

/** Duration and a still frame after 1 s (or the first frame for very short clips). */
export async function processVideo(ctx: MediaContext, itemId: string) {
  const source = original(ctx, itemId)
  const result = await probe(source.file, true)
  const durationMs = durationOf(result)
  const frame = async (offset: string) =>
    runTool(
      'ffmpeg',
      ['-v', 'error', '-ss', offset, '-i', source.file, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', 'pipe:1'],
      {
        timeoutMs: 60_000,
        maxBuffer: 64 * 1024 * 1024,
      },
    )
  let still = await frame('1')
  if (still.length === 0) still = await frame('0')
  if (still.length > 0) {
    const poster = await webp(still, PREVIEW_MAX)
    ctx.items.addAssetFromBuffer(itemId, 'poster', poster.data, 'image/webp', 'poster.webp', poster.info)
  }
  const stream = result.streams?.[0]
  ctx.items.setProcessed(itemId, {
    meta: {
      ...(durationMs ? { durationMs } : {}),
      ...(stream?.width ? { width: stream.width, height: stream.height } : {}),
    },
  })
}

/** Text files: first 2 KB as preview, up to 200 KB for the search (Phase 7). Other files: nothing to do. */
export async function processDocument(ctx: MediaContext, itemId: string) {
  const source = original(ctx, itemId)
  if (!isTextMime(source.mime)) {
    ctx.items.setProcessed(itemId, {})
    return
  }
  const handle = fs.openSync(source.file, 'r')
  const buffer = Buffer.alloc(TEXT_INDEX_BYTES)
  const read = fs.readSync(handle, buffer, 0, TEXT_INDEX_BYTES, 0)
  fs.closeSync(handle)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer.subarray(0, read)).replace(/�+$/, '')
  if (text.trim()) ctx.items.setText(itemId, 'doc', text)
  const preview = text.slice(0, TEXT_PREVIEW_BYTES).split('\n').slice(0, 12).join('\n').trim()
  ctx.items.setProcessed(itemId, { meta: preview ? { textPreview: preview } : {} })
}
