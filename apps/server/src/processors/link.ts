import type { ItemMeta } from '@wb/shared'
import * as cheerio from 'cheerio'
import ogs from 'open-graph-scraper'
import sharp from 'sharp'
import type { ItemService } from '../items/service.ts'
import { type SafeFetchOptions, safeFetch } from '../lib/safeFetch.ts'
import { domainOf, parseHttpUrl, vimeoId, youtubeId } from '../lib/urls.ts'

const HTML_MAX = 3 * 1024 * 1024
const IMAGE_MAX = 10 * 1024 * 1024
const JSON_MAX = 512 * 1024

export type LinkContext = { items: ItemService; fetchOptions?: Partial<SafeFetchOptions> }

type Preview = {
  title?: string | undefined
  description?: string | undefined
  siteName?: string | undefined
  image?: string | undefined
  favicon?: string | undefined
  isPlace?: boolean
}

const OEMBED: { match: (url: URL) => boolean; endpoint: string }[] = [
  { match: (url) => youtubeId(url) !== null, endpoint: 'https://www.youtube.com/oembed?format=json&url=' },
  { match: (url) => vimeoId(url) !== null, endpoint: 'https://vimeo.com/api/oembed.json?url=' },
  { match: (url) => url.hostname === 'open.spotify.com', endpoint: 'https://open.spotify.com/oembed?url=' },
  { match: (url) => /(^|\.)tiktok\.com$/.test(url.hostname), endpoint: 'https://www.tiktok.com/oembed?url=' },
  {
    match: (url) => /(^|\.)(twitter|x)\.com$/.test(url.hostname),
    endpoint: 'https://publish.twitter.com/oembed?omit_script=1&url=',
  },
]

const clip = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim().slice(0, max) : undefined

/** Place name from Google Maps / OpenStreetMap URLs (PLAN.md 5.5). */
export function placeFromUrl(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '')
  const isGoogleMaps =
    (host.startsWith('google.') && url.pathname.startsWith('/maps')) ||
    host === 'maps.google.com' ||
    host === 'maps.app.goo.gl'
  if (isGoogleMaps) {
    const place = /\/maps\/place\/([^/]+)/.exec(url.pathname)?.[1]
    const query = url.searchParams.get('q') ?? url.searchParams.get('query')
    const name = place ? decodeURIComponent(place.replace(/\+/g, ' ')) : query
    return name?.trim() || 'Ort in Google Maps'
  }
  if (host === 'openstreetmap.org' || host === 'osm.org') {
    const lat = url.searchParams.get('mlat')
    const lon = url.searchParams.get('mlon')
    return lat && lon ? `Ort ${lat}, ${lon}` : 'Ort in OpenStreetMap'
  }
  return null
}

/** Parses already loaded HTML: OpenGraph/Twitter cards first, then <title>/<meta description>. */
export async function parseHtml(html: string, pageUrl: string): Promise<Preview> {
  const absolute = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return undefined
    try {
      return new URL(value.trim(), pageUrl).href
    } catch {
      return undefined
    }
  }
  let preview: Preview = {}
  try {
    const { result } = await ogs({ html })
    preview = {
      title: clip(result.ogTitle ?? result.twitterTitle, 300),
      description: clip(result.ogDescription ?? result.twitterDescription, 500),
      siteName: clip(result.ogSiteName, 100),
      image: absolute(result.ogImage?.[0]?.url ?? result.twitterImage?.[0]?.url),
      favicon: absolute(result.favicon),
    }
  } catch {
    // open-graph-scraper rejects pages without any OpenGraph data; fall back below.
  }
  const $ = cheerio.load(html)
  preview.title ??= clip($('title').first().text(), 300)
  preview.description ??= clip($('meta[name="description"]').attr('content'), 500)
  preview.favicon ??= absolute(
    $('link[rel~="icon"][type="image/png"]').attr('href') ??
      $('link[rel="apple-touch-icon"]').attr('href') ??
      $('link[rel~="icon"]').attr('href'),
  )
  return preview
}

async function fetchJson(url: string, options: Partial<SafeFetchOptions>) {
  const response = await safeFetch(url, { maxBytes: JSON_MAX, accept: 'application/json', ...options })
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
  return JSON.parse(response.body.toString('utf8')) as Record<string, unknown>
}

async function downloadImage(url: string, max: number, options: Partial<SafeFetchOptions>, format: 'webp' | 'png') {
  const response = await safeFetch(url, { maxBytes: IMAGE_MAX, accept: 'image/*', ...options })
  if (response.status !== 200 || !response.contentType.startsWith('image/') || response.contentType.includes('svg'))
    return null
  const image = sharp(response.body, { failOn: 'none', limitInputPixels: 60_000_000 }).resize({
    width: max,
    height: max,
    fit: 'inside',
    withoutEnlargement: true,
  })
  return (format === 'webp' ? image.webp({ quality: 80 }) : image.png()).toBuffer({ resolveWithObject: true })
}

/**
 * Link preview (PLAN.md 5.5): oEmbed where known → OpenGraph/Twitter → <title>/<meta> → fallback
 * with domain and favicon. Pages that block bots still end up "ready".
 */
export async function unfurlLink(ctx: LinkContext, itemId: string) {
  const item = ctx.items.row(itemId)
  const url = item?.url ? parseHttpUrl(item.url) : null
  if (!item || !url) throw new Error('item without URL')
  const options = ctx.fetchOptions ?? {}
  const preview: Preview = {}

  const place = placeFromUrl(url)
  if (place) {
    preview.title = place
    preview.isPlace = true
  }

  const youtube = youtubeId(url)
  const oembed = OEMBED.find((entry) => entry.match(url))
  if (oembed) {
    try {
      const data = await fetchJson(oembed.endpoint + encodeURIComponent(url.href), options)
      preview.title ??= clip(data.title, 300)
      preview.siteName = clip(data.provider_name, 100)
      preview.description = clip(data.author_name, 200)
      preview.image = typeof data.thumbnail_url === 'string' ? data.thumbnail_url : undefined
    } catch {
      // Falls through to the HTML page.
    }
  }
  if (youtube) preview.image = `https://i.ytimg.com/vi/${youtube}/hqdefault.jpg`

  if (!preview.title || (!preview.image && !place)) {
    try {
      const page = await safeFetch(url.href, {
        maxBytes: HTML_MAX,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        ...options,
      })
      if (page.contentType.includes('html')) {
        const parsed = await parseHtml(page.body.toString('utf8'), page.url)
        for (const [key, value] of Object.entries(parsed) as [keyof Preview, string][]) {
          if (value !== undefined && preview[key] === undefined) (preview as Record<string, unknown>)[key] = value
        }
      } else if (page.contentType.startsWith('image/')) {
        preview.image ??= page.url
      }
    } catch {
      // Blocked, too large or offline: fallback card with domain and favicon.
    }
  }

  if (preview.image) {
    try {
      const image = await downloadImage(preview.image, 800, options, 'webp')
      if (image) ctx.items.addAssetFromBuffer(itemId, 'og_image', image.data, 'image/webp', 'preview.webp', image.info)
    } catch {
      // No preview image then.
    }
  }
  const favicon = preview.favicon ?? new URL('/favicon.ico', url).href
  try {
    const icon = await downloadImage(favicon, 64, options, 'png')
    if (icon) ctx.items.addAssetFromBuffer(itemId, 'favicon', icon.data, 'image/png', 'favicon.png', icon.info)
  } catch {
    // .ico files and broken icons are skipped.
  }

  const meta: ItemMeta = { domain: domainOf(url.href) }
  if (preview.siteName) meta.siteName = preview.siteName
  if (preview.description) meta.description = preview.description
  if (preview.isPlace) meta.isPlace = true

  // Text that equals the page title becomes the title (PLAN.md 5.5, step 3).
  let title = item.title
  let note = item.note
  if (!title && note && preview.title && note.trim().toLowerCase() === preview.title.toLowerCase()) {
    title = note
    note = null
  }
  title ??= preview.title ?? null
  ctx.items.setProcessed(itemId, { meta, title, note })
}
