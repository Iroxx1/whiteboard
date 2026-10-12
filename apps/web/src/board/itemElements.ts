import { convertToExcalidrawElements, FONT_FAMILY, ROUNDNESS } from '@excalidraw/excalidraw'
import type { ExcalidrawElement, ExcalidrawEmbeddableElement, FileId } from '@excalidraw/excalidraw/element/types'
import type { Item, WbItemData } from '@wb/shared'
import { cardSize, imageSize, STICKY_MIN_HEIGHT, STICKY_WIDTH } from './layout.ts'

export const STICKY_YELLOW = '#FFF3BF'

type Size = { width: number; height: number }
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

const randomId = () => Math.random().toString(36).slice(2, 12)

/** Rounded sticky note without border; the bound text keeps its own dark colour (SPIKES.md). */
export function stickyElements(text: string, color: string, x: number, y: number): ExcalidrawElement[] {
  return convertToExcalidrawElements([
    {
      type: 'rectangle',
      x,
      y,
      width: STICKY_WIDTH,
      height: STICKY_MIN_HEIGHT,
      backgroundColor: color,
      strokeColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      roughness: 0,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
      // Excalidraw only creates bound text for a non-empty label; a space keeps it editable.
      label: {
        text: text || ' ',
        strokeColor: '#1e1e1e',
        fontFamily: FONT_FAMILY.Nunito,
        fontSize: 20,
        textAlign: 'left',
        verticalAlign: 'top',
      },
    },
  ])
}

/**
 * Card element (PLAN.md 5.4): `convertToExcalidrawElements` passes embeddables through without
 * defaults, so a complete rectangle is created and turned into an embeddable (SPIKES.md).
 */
export function cardElement(item: Item, x: number, y: number, size: Size): ExcalidrawEmbeddableElement {
  const [base] = convertToExcalidrawElements([
    {
      type: 'rectangle',
      x,
      y,
      width: size.width,
      height: size.height,
      strokeColor: 'transparent',
      backgroundColor: 'transparent',
      roughness: 0,
      roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
    },
  ])
  if (!base) throw new Error('could not create card')
  return {
    ...base,
    type: 'embeddable',
    link: `${window.location.origin}/i/${item.id}`,
  } as unknown as ExcalidrawEmbeddableElement
}

/** Size an item takes on the board before it is created (for placing it in the frame grid). */
export function itemFootprint(item: Item): Size {
  if (item.kind === 'note') {
    // Estimate: ~22 characters per line at Nunito 20 in 240 px, 25 px per line; the real height
    // comes from Excalidraw's text measurement.
    const text = [item.title, item.note].filter(Boolean).join('\n')
    const lines = text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 22)), 0)
    return { width: STICKY_WIDTH, height: Math.max(STICKY_MIN_HEIGHT, lines * 25 + 30) }
  }
  if (item.kind === 'image') {
    const size = imageSize(
      item.meta.width ?? item.assets.display?.width,
      item.meta.height ?? item.assets.display?.height,
    )
    return item.note ? { width: size.width, height: size.height + 60 } : size
  }
  return cardSize(item)
}

/**
 * Board elements for an item at a top-left position (PLAN.md 4.7): notes become sticky notes,
 * images native images (+ caption, grouped), everything else a card. All carry customData.wb.
 */
export function itemElements(item: Item, x: number, y: number, frameId: string | null = null): ExcalidrawElement[] {
  const wb: WbItemData = { itemId: item.id, kind: item.kind }
  let elements: ExcalidrawElement[]
  if (item.kind === 'note') {
    const text = [item.title, item.note].filter(Boolean).join('\n\n')
    elements = stickyElements(text, STICKY_YELLOW, x, y)
  } else if (item.kind === 'image' && item.assets.display) {
    const size = imageSize(item.assets.display.width, item.assets.display.height)
    const [image] = convertToExcalidrawElements([
      { type: 'image', fileId: item.assets.display.id as FileId, x, y, width: size.width, height: size.height },
    ])
    if (!image) throw new Error('could not create image')
    elements = [{ ...image, status: 'saved' } as ExcalidrawElement]
    const caption = item.note ?? item.title
    if (caption) {
      const [text] = convertToExcalidrawElements([
        {
          type: 'text',
          x,
          y: y + size.height + 10,
          text: caption,
          fontFamily: FONT_FAMILY.Nunito,
          fontSize: 16,
          strokeColor: '#1e1e1e',
        },
      ])
      if (text) {
        const groupId = randomId()
        elements = elements.map((element) => ({ ...element, groupIds: [groupId] }))
        elements.push({ ...text, groupIds: [groupId] })
      }
    }
  } else {
    elements = [cardElement(item, x, y, cardSize(item))]
  }
  return elements.map((element) => {
    const next = { ...element, customData: { ...element.customData, wb } } as Mutable<ExcalidrawElement>
    if (frameId) next.frameId = frameId
    return next as ExcalidrawElement
  })
}

export function wbOf(element: ExcalidrawElement): WbItemData | undefined {
  return (element.customData as { wb?: WbItemData } | undefined)?.wb
}
