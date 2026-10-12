import type { ItemService } from '../items/service.ts'
import type { JobDefinition } from '../jobs/queue.ts'
import type { SafeFetchOptions } from '../lib/safeFetch.ts'
import { unfurlLink } from './link.ts'
import { processAudio, processDocument, processImage, processPdf, processVideo } from './media.ts'

export type ProcessorOptions = { items: ItemService; tmpDir: string; fetchOptions?: Partial<SafeFetchOptions> }

/** Job types with their limits (PLAN.md 5.5 table). */
export function processorJobs(options: ProcessorOptions): Record<string, JobDefinition> {
  const { items } = options
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
      (id) => unfurlLink({ items, ...(options.fetchOptions ? { fetchOptions: options.fetchOptions } : {}) }, id),
      2,
      false,
    ),
    process_image: itemJob((id) => processImage(options, id), 1, true),
    process_pdf: itemJob((id) => processPdf(options, id), 1, true),
    process_audio: itemJob((id) => processAudio(options, id), 1, false),
    process_video: itemJob((id) => processVideo(options, id), 1, true),
    process_document: itemJob((id) => processDocument(options, id), 1, false),
  }
}
