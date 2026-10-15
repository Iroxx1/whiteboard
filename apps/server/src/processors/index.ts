import type { ItemService } from '../items/service.ts'
import type { JobDefinition } from '../jobs/queue.ts'
import type { SafeFetchOptions } from '../lib/safeFetch.ts'
import { extractArticle } from './article.ts'
import { unfurlLink } from './link.ts'
import { processAudio, processDocument, processImage, processPdf, processVideo } from './media.ts'
import { ocrImage, ocrPdf } from './ocr.ts'
import { transcribeAudio } from './transcribe.ts'

export type ProcessorOptions = {
  items: ItemService
  tmpDir: string
  fetchOptions?: Partial<SafeFetchOptions>
  /** Text recognition (PLAN.md 5.10); null = off. */
  ocrLangs?: string | null
  /** Whisper server endpoint (PLAN.md 5.11); null = speech to text off. */
  whisperUrl?: string | null
}

/** Job types with their limits (PLAN.md 5.5 table). */
export function processorJobs(options: ProcessorOptions): Record<string, JobDefinition> {
  const { items } = options
  const ocr = options.ocrLangs ? { items, tmpDir: options.tmpDir, langs: options.ocrLangs } : null
  // One OCR at a time, counted as heavy; a failed recognition only leaves the text out.
  const ocrJob = (run: (itemId: string) => Promise<void>): JobDefinition => ({
    concurrency: 1,
    heavy: true,
    handler: async (payload) => {
      const itemId = String(payload.itemId)
      if (items.row(itemId)) await run(itemId)
    },
    onFailed: (payload) => items.patchMeta(String(payload.itemId), { ocrDone: true }),
  })
  const linkContext = { items, ...(options.fetchOptions ? { fetchOptions: options.fetchOptions } : {}) }
  const itemJob = (run: (itemId: string) => Promise<void>, concurrency: number, heavy: boolean): JobDefinition => ({
    concurrency,
    heavy,
    handler: async (payload) => {
      const itemId = String(payload.itemId)
      if (!items.row(itemId)) return
      await run(itemId)
    },
    onFailed: (payload, error) => items.setFailed(String(payload.itemId), error),
  })
  return {
    unfurl_link: itemJob(
      async (id) => {
        await unfurlLink(linkContext, id)
        // Reading text for search and details (PLAN.md 5.9); its own job so a slow page does not
        // hold back the card.
        items.queueJob('extract_article', { itemId: id })
      },
      2,
      false,
    ),
    extract_article: {
      concurrency: 1,
      heavy: false,
      handler: async (payload) => {
        const itemId = String(payload.itemId)
        if (items.row(itemId)) await extractArticle(linkContext, itemId)
      },
    },
    process_image: itemJob(
      async (id) => {
        await processImage(options, id)
        if (ocr) items.queueJob('ocr_image', { itemId: id })
      },
      1,
      true,
    ),
    process_pdf: itemJob(
      async (id) => {
        await processPdf(options, id)
        if (ocr) items.queueJob('ocr_pdf', { itemId: id })
      },
      1,
      true,
    ),
    // OCR after the normal processing: the card is ready first, the text follows (PLAN.md 5.10).
    ocr_image: ocrJob(async (id) => {
      if (ocr) await ocrImage(ocr, id)
    }),
    ocr_pdf: ocrJob(async (id) => {
      const detail = items.detail(id)
      if (ocr && detail) {
        const text = detail.texts.find((entry) => entry.kind === 'pdf')?.text ?? ''
        await ocrPdf(ocr, id, text, detail.meta.pageCount ?? 1)
      }
    }),
    process_audio: itemJob(
      async (id) => {
        await processAudio(options, id, Boolean(options.whisperUrl))
        if (options.whisperUrl) items.queueJob('transcribe_audio', { itemId: id })
      },
      1,
      false,
    ),
    // Speech to text after the normal processing: the player is usable first (PLAN.md 5.11). One at a
    // time and heavy; a failure only leaves the transcript out.
    transcribe_audio: {
      concurrency: 1,
      heavy: true,
      handler: async (payload) => {
        const itemId = String(payload.itemId)
        if (items.row(itemId) && options.whisperUrl) await transcribeAudio({ items, url: options.whisperUrl }, itemId)
      },
      onFailed: (payload) => items.setTranscript(String(payload.itemId), null, ''),
    },
    process_video: itemJob((id) => processVideo(options, id), 1, true),
    process_document: itemJob((id) => processDocument(options, id), 1, false),
  }
}
