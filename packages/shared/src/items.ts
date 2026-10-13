// Inbox items (PLAN.md 4.7, 5.2, 5.4).

export const ITEM_KINDS = ['note', 'link', 'image', 'pdf', 'document', 'audio', 'video', 'file'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]
export type ItemStatus = 'inbox' | 'placed' | 'archived' | 'trashed'
export type ItemSource = 'pwa' | 'telegram' | 'email' | 'web'
export type Processing = 'pending' | 'ready' | 'failed'
export type AssetRole = 'original' | 'display' | 'thumb' | 'og_image' | 'favicon' | 'poster' | 'page1'

export type AssetInfo = { id: string; mime: string; size: number; width: number | null; height: number | null }

export type Embed = { provider: 'youtube' | 'vimeo' | 'spotify' | 'instagram'; embedUrl: string }

/** Kind-specific metadata filled by ingest and the processors. */
export type ItemMeta = {
  // links
  domain?: string
  siteName?: string
  description?: string
  embed?: Embed
  isVideo?: boolean
  isPlace?: boolean
  // files
  filename?: string
  mime?: string
  size?: number
  ext?: string
  pageCount?: number
  durationMs?: number
  width?: number
  height?: number
  textPreview?: string
  /** Text recognition ran (with or without result), so it is not repeated (Phase 8). */
  ocrDone?: boolean
}

export type Item = {
  id: string
  createdAt: number
  createdByName: string | null
  source: ItemSource
  kind: ItemKind
  status: ItemStatus
  title: string | null
  note: string | null
  url: string | null
  groupId: string | null
  targetBoardId: string | null
  targetBoardName: string | null
  processing: Processing
  processingError: string | null
  meta: ItemMeta
  updatedAt: number
  trashedAt: number | null
  assets: Partial<Record<AssetRole, AssetInfo>>
}

export type ItemDetail = Item & {
  texts: { kind: 'article' | 'pdf' | 'ocr' | 'transcript' | 'doc'; text: string }[]
  placements: { boardId: string; boardName: string; deleted: boolean }[]
}

export type ItemList = { items: Item[]; nextCursor: string | null }

export type IngestResult = { items: Item[]; duplicateIds: string[] }

/** Default card sizes on the board (PLAN.md 5.4). */
export const CARD_SIZES = {
  linkWithImage: { width: 340, height: 300 },
  link: { width: 340, height: 130 },
  document: { width: 340, height: 260 },
  audio: { width: 340, height: 160 },
  video: { width: 340, height: 240 },
} as const

/** Inbox items on the board carry this in customData.wb. */
export type WbItemData = { itemId: string; kind: ItemKind }
export type WbFrameData = { role: 'inbox-frame' }
