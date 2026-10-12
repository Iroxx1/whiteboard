// Pure layout rules for placing inbox items (PLAN.md 5.4), free of Excalidraw for unit tests.
import { CARD_SIZES, type Item } from '@wb/shared'

export type Rect = { x: number; y: number; width: number; height: number }

export const FRAME_WIDTH = 1520
export const FRAME_HEIGHT = 1000
export const FRAME_OFFSET = 1720
const COLUMNS = 4
const COLUMN_WIDTH = 340
const GAP = 40
const PADDING = 20
const STEP = 20

export const IMAGE_LONG_SIDE = 400
export const STICKY_WIDTH = 240
export const STICKY_MIN_HEIGHT = 180

/** Where a new inbox frame goes: left of the existing content, or at (0, 0) on an empty board. */
export function newFramePosition(content: Rect[]): Rect {
  if (content.length === 0) return { x: 0, y: 0, width: FRAME_WIDTH, height: FRAME_HEIGHT }
  const minX = Math.min(...content.map((rect) => rect.x))
  const minY = Math.min(...content.map((rect) => rect.y))
  return { x: minX - FRAME_OFFSET, y: minY, width: FRAME_WIDTH, height: FRAME_HEIGHT }
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width + GAP / 2 &&
  b.x < a.x + a.width + GAP / 2 &&
  a.y < b.y + b.height + GAP / 2 &&
  b.y < a.y + a.height + GAP / 2

/**
 * Next free spot in the frame: 4 columns of 340 px with 40 px gaps, searched row by row; a spot is
 * taken if it overlaps an existing child. Returns the position and the frame height needed.
 */
export function nextSlot(frame: Rect, children: Rect[], size: { width: number; height: number }) {
  const left = frame.x + PADDING
  for (let y = frame.y + PADDING; y < frame.y + frame.height + 100_000; y += STEP) {
    for (let column = 0; column < COLUMNS; column++) {
      const x = left + column * (COLUMN_WIDTH + GAP)
      // Wide items (e.g. 400 px images) may not stick out on the right.
      if (column > 0 && x + size.width > frame.x + frame.width - PADDING) continue
      const rect = { x, y, width: size.width, height: size.height }
      if (!children.some((child) => overlaps(rect, child))) {
        return { x, y, frameHeight: Math.max(frame.height, y + size.height + PADDING - frame.y) }
      }
    }
  }
  throw new Error('no free slot')
}

/** Long side 400 px for images on the board (decided 12.10.2026). */
export function imageSize(width: number | null | undefined, height: number | null | undefined) {
  if (!width || !height) return { width: IMAGE_LONG_SIDE, height: IMAGE_LONG_SIDE * 0.75 }
  const scale = IMAGE_LONG_SIDE / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** Card size per kind (PLAN.md 5.4 table). */
export function cardSize(item: Item): { width: number; height: number } {
  switch (item.kind) {
    case 'link':
      if (item.meta.isVideo) return CARD_SIZES.video
      return item.assets.og_image || item.processing === 'pending' ? CARD_SIZES.linkWithImage : CARD_SIZES.link
    case 'pdf':
    case 'document':
      return CARD_SIZES.document
    case 'audio':
      return CARD_SIZES.audio
    case 'video':
      return CARD_SIZES.video
    default:
      return CARD_SIZES.link
  }
}
