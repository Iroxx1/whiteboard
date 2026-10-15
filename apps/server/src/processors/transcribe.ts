import fs from 'node:fs'
import type { ItemService } from '../items/service.ts'

/** Transcript text kept for the search and the detail view. */
const TRANSCRIPT_MAX = 200_000
/** First characters shown on the card. */
const PREVIEW_CHARS = 200

export type TranscribeContext = { items: ItemService; url: string }

/** Timeout = 10 × duration + 60 s (PLAN.md 5.11); 30 min when the duration is unknown. */
export function transcribeTimeoutMs(durationMs: number | undefined): number {
  return durationMs ? durationMs * 10 + 60_000 : 30 * 60_000
}

/** whisper.cpp marks sounds as "[Musik]" or "(Applaus)" and may add line breaks; tidy that up. */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[(?:BLANK_AUDIO|_[A-Z]+_)\]/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** `transcribe_audio` (PLAN.md 5.11): voice message or audio file → "Transkript". */
export async function transcribeAudio(ctx: TranscribeContext, itemId: string) {
  const source = ctx.items.assetPath(itemId, 'original')
  if (!source) return
  const durationMs = ctx.items.detail(itemId)?.meta.durationMs
  const form = new FormData()
  form.append('file', new Blob([fs.readFileSync(source.file)], { type: source.mime }), 'audio')
  form.append('response_format', 'json')
  form.append('temperature', '0')
  const response = await fetch(ctx.url, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(transcribeTimeoutMs(durationMs)),
  })
  if (!response.ok) throw new Error(`whisper answered ${response.status}`)
  const body = (await response.json()) as { text?: unknown; error?: unknown }
  if (typeof body.text !== 'string') throw new Error(`whisper: ${String(body.error ?? 'no text in the answer')}`)
  const text = cleanTranscript(body.text)
  ctx.items.setTranscript(itemId, text ? text.slice(0, TRANSCRIPT_MAX) : null, text.slice(0, PREVIEW_CHARS))
}

/** Whether the whisper server answers (its root page); used by /healthz and the system page. */
export async function whisperReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(new URL('/', url), { signal: AbortSignal.timeout(2000) })
    await response.body?.cancel()
    return response.ok
  } catch {
    return false
  }
}
