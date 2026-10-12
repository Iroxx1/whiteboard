import type { AssetInfo, Item } from '@wb/shared'
import { de } from '../i18n/de.ts'
import { formatBytes } from '../lib/api.ts'
import { formatRelative } from '../lib/format.ts'

const dayMonth = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit' })

/** Best human title: title, file name, page domain or the beginning of the note. */
export function itemTitle(item: Item): string {
  return (
    item.title ??
    item.meta.filename ??
    (item.kind === 'note' ? item.note?.split('\n')[0]?.slice(0, 80) : undefined) ??
    item.meta.domain ??
    item.url ??
    de.kinds[item.kind]
  )
}

/** "via Telegram · Anna · 12.10." (PLAN.md 4.7). */
export function itemProvenance(item: Item): string {
  return de.card.via(de.sources[item.source], item.createdByName, `${dayMonth.format(item.createdAt)}.`)
}

export function itemSubline(item: Item): string {
  return [item.createdByName, de.sources[item.source], formatRelative(item.createdAt)].filter(Boolean).join(' · ')
}

/** Picture to show for an item, if any. */
export function previewAsset(item: Item): AssetInfo | undefined {
  return item.assets.thumb ?? item.assets.og_image ?? item.assets.page1 ?? item.assets.poster ?? item.assets.display
}

const EXT_ICONS: Record<string, string> = {
  doc: '📝',
  docx: '📝',
  odt: '📝',
  rtf: '📝',
  xls: '📊',
  xlsx: '📊',
  ods: '📊',
  csv: '📊',
  ppt: '📽️',
  pptx: '📽️',
  odp: '📽️',
  zip: '🗜️',
  rar: '🗜️',
  '7z': '🗜️',
  txt: '📄',
  md: '📄',
}

export function itemIcon(item: Item): string {
  if (item.kind === 'link') return item.meta.isPlace ? '📍' : item.meta.isVideo ? '▶️' : '🔗'
  if (item.kind === 'image') return '🖼️'
  if (item.kind === 'pdf') return '📕'
  if (item.kind === 'audio') return '🎵'
  if (item.kind === 'video') return '🎬'
  if (item.kind === 'note') return '🗒️'
  return EXT_ICONS[item.meta.ext ?? ''] ?? '📎'
}

export function formatDuration(ms: number | undefined): string | null {
  if (!ms) return null
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export function fileFacts(item: Item): string {
  return [
    item.meta.ext?.toUpperCase(),
    item.meta.pageCount ? de.card.pages(item.meta.pageCount) : null,
    formatDuration(item.meta.durationMs),
    item.meta.size ? formatBytes(item.meta.size) : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
