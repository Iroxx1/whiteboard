import type { ItemKind, ItemMeta, ItemSource } from '@wb/shared'
import { resolveHashtags } from '../lib/hashtags.ts'
import { extensionOf, kindForMime, sanitizeFilename, sniffFile } from '../lib/mime.ts'
import { domainOf, findUrls, normalizeUrl, parseHttpUrl, stripUrls, vimeoId, youtubeId } from '../lib/urls.ts'

/** What every channel delivers (PLAN.md 5.5). */
export type IngestPayload = {
  userId: string
  source: ItemSource
  title?: string | undefined
  text?: string | undefined
  url?: string | undefined
  files: IngestFile[]
  targetBoardId?: string | null | undefined
  groupKey?: string | undefined
  sourceMeta?: Record<string, unknown> | undefined
}

export type IngestFile = { filename: string; mime?: string | undefined; size: number; tmpPath: string }

export type Draft = {
  kind: ItemKind
  title: string | null
  note: string | null
  url: string | null
  urlNormalized: string | null
  /** Index into payload.files for file items. */
  fileIndex: number | null
  meta: ItemMeta
}

export type Normalized = {
  drafts: Draft[]
  targetBoardId: string | null
  unknownHashtags: string[]
}

const MAX_TITLE = 300
const MAX_NOTE = 10_000

const clean = (value: string | undefined | null, max: number) => {
  const trimmed = value?.replace(/\r\n?/g, '\n').trim()
  return trimmed ? trimmed.slice(0, max) : null
}

export function linkMeta(url: string): ItemMeta {
  const meta: ItemMeta = { domain: domainOf(url) }
  const youtube = youtubeId(url)
  if (youtube) {
    meta.isVideo = true
    meta.embed = { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${youtube}` }
  }
  const vimeo = vimeoId(url)
  if (vimeo) {
    meta.isVideo = true
    meta.embed = { provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${vimeo}` }
  }
  const spotify = /^\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/.exec(
    parseHttpUrl(url)?.hostname === 'open.spotify.com' ? (parseHttpUrl(url)?.pathname ?? '') : '',
  )
  if (spotify)
    meta.embed = { provider: 'spotify', embedUrl: `https://open.spotify.com/embed/${spotify[1]}/${spotify[2]}` }
  return meta
}

function linkDraft(url: string, title: string | null, note: string | null): Draft {
  return { kind: 'link', title, note, url, urlNormalized: normalizeUrl(url), fileIndex: null, meta: linkMeta(url) }
}

/**
 * Turns a payload into item drafts (PLAN.md 5.5): find URLs (Android often puts them into `text`),
 * resolve `#board` hashtags, then one link per URL, a note for plain text, one item per file.
 */
export async function normalizePayload(
  payload: IngestPayload,
  boardsByHashtag: ReadonlyMap<string, string>,
  sniff: (file: string, filename: string) => Promise<string> = sniffFile,
): Promise<Normalized> {
  const titleTags = resolveHashtags(payload.title ?? '', boardsByHashtag)
  const textTags = resolveHashtags(payload.text ?? '', boardsByHashtag)
  const inboxOnly = titleTags.inboxOnly || textTags.inboxOnly
  const hashtagBoard = inboxOnly ? null : (textTags.boardId ?? titleTags.boardId)
  const targetBoardId = payload.targetBoardId ?? hashtagBoard

  const title = clean(titleTags.text, MAX_TITLE)
  const text = textTags.text
  const urls: string[] = []
  const explicit = payload.url ? parseHttpUrl(payload.url.trim()) : null
  if (explicit) urls.push(explicit.href)
  for (const url of findUrls(text)) if (!urls.includes(url)) urls.push(url)

  let note = clean(stripUrls(text, urls), MAX_NOTE)
  // Android shares "page title" + URL; the text left over is often just the title again.
  // Text equal to the fetched page title becomes the title later (unfurl_link).
  if (note && title && note === title) note = null

  const drafts: Draft[] = []
  if (payload.files.length > 0) {
    for (const [index, file] of payload.files.entries()) {
      const mime = await sniff(file.tmpPath, file.filename)
      const filename = sanitizeFilename(file.filename)
      drafts.push({
        kind: kindForMime(mime),
        title: index === 0 && payload.files.length === 1 ? title : null,
        note: index === 0 ? note : null,
        url: null,
        urlNormalized: null,
        fileIndex: index,
        meta: { filename, mime, size: file.size, ext: extensionOf(filename) },
      })
    }
    for (const url of urls) drafts.push(linkDraft(url, null, null))
  } else if (urls.length === 1) {
    drafts.push(linkDraft(urls[0] as string, title, note))
  } else if (urls.length > 1) {
    for (const url of urls) drafts.push(linkDraft(url, null, note ?? title))
  } else if (note || title) {
    drafts.push({
      kind: 'note',
      title: note ? title : null,
      note: note ?? title,
      url: null,
      urlNormalized: null,
      fileIndex: null,
      meta: {},
    })
  }

  return { drafts, targetBoardId, unknownHashtags: [...titleTags.unknown, ...textTags.unknown] }
}
