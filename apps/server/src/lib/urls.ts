// URL detection and normalisation for ingest (PLAN.md 5.5).

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+|\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"'`]*/gi
const TRAILING = /[.,;:!?)\]}»"'’”]+$/

const TRACKING_PARAMS = /^(utm_.+|fbclid|gclid|dclid|msclkid|mc_eid|mc_cid|igshid|_ga)$/i
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'])

/** Parses an http(s) URL; returns null for anything else. */
export function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** All URLs in a text, in order, without duplicates; trailing punctuation is not part of a URL. */
export function findUrls(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(URL_PATTERN)) {
    let candidate = match[0].replace(TRAILING, '')
    // Keep a closing bracket when the URL itself contains the opening one (Wikipedia style).
    if (match[0].length > candidate.length && match[0][candidate.length] === ')' && candidate.includes('(')) {
      candidate += ')'
    }
    if (candidate.toLowerCase().startsWith('www.')) candidate = `https://${candidate}`
    const url = parseHttpUrl(candidate)
    if (url && !found.includes(url.href)) found.push(url.href)
  }
  return found
}

export function youtubeId(value: string | URL): string | null {
  const url = typeof value === 'string' ? parseHttpUrl(value) : value
  if (!url || !YOUTUBE_HOSTS.has(url.hostname)) return null
  if (url.hostname === 'youtu.be') return /^\/([\w-]{6,20})/.exec(url.pathname)?.[1] ?? null
  if (url.pathname === '/watch') return url.searchParams.get('v')
  return /^\/(?:shorts|embed|live|v)\/([\w-]{6,20})/.exec(url.pathname)?.[1] ?? null
}

export function vimeoId(value: string | URL): string | null {
  const url = typeof value === 'string' ? parseHttpUrl(value) : value
  if (!url || !/(^|\.)vimeo\.com$/.test(url.hostname)) return null
  return /^\/(?:video\/)?(\d{5,12})(?:\/|$)/.exec(url.pathname)?.[1] ?? null
}

/**
 * Key for duplicate detection: lower-case host without "www.", no fragment, no default port,
 * no tracking parameters (`si` only for YouTube), sorted query. The original URL is kept elsewhere.
 */
export function normalizeUrl(value: string): string | null {
  const url = parseHttpUrl(value)
  if (!url) return null
  const youtube = youtubeId(url)
  if (youtube) return `youtube:${youtube}`
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.test(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const query = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : ''
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
  return `${host}${url.port ? `:${url.port}` : ''}${path}${query}`
}

/** Removes the given URLs from a text and tidies up the whitespace left behind. */
export function stripUrls(text: string, urls: string[]): string {
  let result = text
  for (const match of [...text.matchAll(URL_PATTERN)]) {
    const raw = match[0].replace(TRAILING, '')
    const href = parseHttpUrl(raw.toLowerCase().startsWith('www.') ? `https://${raw}` : raw)?.href
    if (href && urls.includes(href)) result = result.replace(raw, ' ')
  }
  return result
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function domainOf(value: string): string {
  return parseHttpUrl(value)?.hostname.replace(/^www\./, '') ?? ''
}
