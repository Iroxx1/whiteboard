import { Readability } from '@mozilla/readability'
import type { ItemMeta } from '@wb/shared'
import { parseHTML } from 'linkedom'
import { safeFetch } from '../lib/safeFetch.ts'
import { parseHttpUrl } from '../lib/urls.ts'
import type { LinkContext } from './link.ts'

const HTML_MAX = 3 * 1024 * 1024
/** Shorter texts are usually cookie banners or error pages, not articles. */
const MIN_TEXT = 200
const MAX_TEXT = 200_000

/** Readable text of an HTML page (Readability), paragraphs separated by empty lines. */
export function articleText(html: string, pageUrl: string): string | null {
  const { document } = parseHTML(html)
  // Readability resolves relative links against the document URL.
  try {
    Object.defineProperty(document, 'documentURI', { value: pageUrl })
  } catch {
    // Not needed for the text.
  }
  const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], {
    charThreshold: MIN_TEXT,
  }).parse()
  const text = (article?.textContent ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length >= MIN_TEXT ? text.slice(0, MAX_TEXT) : null
}

/**
 * `extract_article` (PLAN.md 5.5, activated in Phase 7): reading text of a link for the search and
 * the details. Videos, music, Instagram and places are skipped; pages without article are fine.
 */
export async function extractArticle(ctx: LinkContext, itemId: string) {
  const item = ctx.items.row(itemId)
  const url = item?.url ? parseHttpUrl(item.url) : null
  if (!item || !url || item.kind !== 'link') return
  const meta = JSON.parse(item.metaJson) as ItemMeta
  if (meta.embed || meta.isVideo || meta.isPlace) return
  let page: Awaited<ReturnType<typeof safeFetch>>
  try {
    page = await safeFetch(url.href, {
      maxBytes: HTML_MAX,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      ...ctx.fetchOptions,
    })
  } catch {
    // Blocked or offline: no reading text, not an error worth retrying three times.
    return
  }
  if (page.status !== 200 || !page.contentType.includes('html')) return
  const text = articleText(page.body.toString('utf8'), page.url)
  if (text) ctx.items.setText(itemId, 'article', text)
}
