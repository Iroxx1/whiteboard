import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { QueryClient } from '@tanstack/react-query'
import type { WbFrameData } from '@wb/shared'
import { api } from '../lib/api.ts'
import type { BoardSync } from './BoardSync.ts'
import { itemElements, wbOf } from './itemElements.ts'
import { primeItems } from './itemsData.ts'
import { newFramePosition, nextSlot, type Rect } from './layout.ts'

export type PlaceTarget = { kind: 'point'; x: number; y: number } | { kind: 'frame' }

export type PlacementNotice =
  | { kind: 'placed'; placements: { itemId: string; elementIds: string[] }[] }
  | { kind: 'taken'; holder: string | null }
  | { kind: 'not-ready' }

const ITEM_GAP = 40
const FRAME_NAME = '📥 Inbox'

const rectOf = (element: ExcalidrawElement): Rect => ({
  x: element.x,
  y: element.y,
  width: element.width,
  height: element.height,
})

function boundsOf(elements: ExcalidrawElement[]): Rect {
  const minX = Math.min(...elements.map((element) => element.x))
  const minY = Math.min(...elements.map((element) => element.y))
  const maxX = Math.max(...elements.map((element) => element.x + element.width))
  const maxY = Math.max(...elements.map((element) => element.y + element.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

const isInboxFrame = (element: ExcalidrawElement) =>
  element.type === 'frame' &&
  !element.isDeleted &&
  (element.customData as { wb?: WbFrameData } | undefined)?.wb?.role === 'inbox-frame'

function translate(elements: ExcalidrawElement[], dx: number, dy: number): ExcalidrawElement[] {
  return elements.map((element) => ({ ...element, x: element.x + dx, y: element.y + dy }) as ExcalidrawElement)
}

/**
 * Places inbox items on the board with the placement protocol (PLAN.md 5.4): claim → check that it
 * is not already on the board → create elements → send them → report done. Runs one at a time so
 * automatic placements do not fight over the same grid slot.
 */
export class Placer {
  private chain: Promise<void> = Promise.resolve()
  private readonly inProgress = new Set<string>()

  constructor(
    private readonly excalidraw: ExcalidrawImperativeAPI,
    private readonly sync: BoardSync,
    private readonly queryClient: QueryClient,
    private readonly notify: (notice: PlacementNotice) => void,
    /** Called after elements were inserted (e.g. to load image files). */
    private readonly afterInsert: () => void = () => {},
  ) {}

  place(itemIds: string[], target: PlaceTarget, auto = false): Promise<void> {
    const fresh = itemIds.filter((id) => !this.inProgress.has(id))
    for (const id of fresh) this.inProgress.add(id)
    this.chain = this.chain
      .then(() => this.run(fresh, target, auto))
      .catch((error: unknown) => console.error('placement failed', error))
      .finally(() => {
        for (const id of fresh) this.inProgress.delete(id)
      })
    return this.chain
  }

  private async run(itemIds: string[], target: PlaceTarget, auto: boolean) {
    if (itemIds.length === 0) return
    const { items } = await api.itemsByIds(itemIds)
    primeItems(this.queryClient, items)
    const placements: { itemId: string; elementIds: string[] }[] = []
    let cursorX = target.kind === 'point' ? target.x : 0

    for (const item of items) {
      if (item.status === 'trashed' || (auto && item.status !== 'inbox')) continue
      if (item.kind === 'image' && !item.assets.display) {
        // The server announces it again once the display version exists.
        if (!auto) this.notify({ kind: 'not-ready' })
        continue
      }
      const claim = await this.sync.claim(item.id)
      if (!claim.granted) {
        if (!auto) this.notify({ kind: 'taken', holder: claim.holder })
        continue
      }
      // Idempotent: someone may have placed it already (e.g. after a reconnect).
      const existing = this.excalidraw
        .getSceneElements()
        .filter((element) => wbOf(element)?.itemId === item.id)
        .map((element) => element.id)
      if (existing.length > 0) {
        await this.sync.done(item.id, existing)
        continue
      }

      const created = itemElements(item, 0, 0)
      const size = boundsOf(created)
      let elements: ExcalidrawElement[]
      let extra: ExcalidrawElement[] = []
      if (target.kind === 'frame') {
        const frame = this.ensureFrame()
        const children = this.excalidraw
          .getSceneElements()
          .filter((element) => element.frameId === frame.element.id)
          .map(rectOf)
        const slot = nextSlot(rectOf(frame.element), children, size)
        elements = translate(created, slot.x - size.x, slot.y - size.y).map(
          (element) => ({ ...element, frameId: frame.element.id }) as ExcalidrawElement,
        )
        const grown =
          slot.frameHeight > frame.element.height
            ? newElementWith(frame.element, { height: slot.frameHeight })
            : frame.element
        extra = frame.created || grown !== frame.element ? [grown] : []
      } else {
        elements = translate(created, cursorX - size.width / 2 - size.x, target.y - size.height / 2 - size.y)
        cursorX += size.width + ITEM_GAP
      }
      this.insert(elements, extra, auto)
      await this.sync.sendNow([...extra, ...elements].map((element) => element.id))
      if (
        await this.sync.done(
          item.id,
          elements.map((element) => element.id),
        )
      ) {
        placements.push({ itemId: item.id, elementIds: elements.map((element) => element.id) })
      }
    }
    if (!auto && placements.length > 0) this.notify({ kind: 'placed', placements })
  }

  /** The board's "📥 Inbox" frame; created left of the content if missing (PLAN.md 5.4). */
  private ensureFrame(): { element: ExcalidrawElement; created: boolean } {
    const scene = this.excalidraw.getSceneElements()
    const frame = scene.find(isInboxFrame)
    if (frame) return { element: frame, created: false }
    const position = newFramePosition(scene.map(rectOf))
    const [created] = convertToExcalidrawElements([{ type: 'frame', children: [], name: FRAME_NAME, ...position }])
    if (!created) throw new Error('could not create frame')
    const element = {
      ...created,
      customData: { wb: { role: 'inbox-frame' } satisfies WbFrameData },
    } as ExcalidrawElement
    return { element, created: true }
  }

  private insert(elements: ExcalidrawElement[], updated: ExcalidrawElement[], auto: boolean) {
    const replaced = new Map(updated.map((element) => [element.id, element]))
    const scene = this.excalidraw
      .getSceneElementsIncludingDeleted()
      .map((element) => replaced.get(element.id) ?? element)
    const added = updated.filter((element) => !scene.some((existing) => existing.id === element.id))
    this.excalidraw.updateScene({
      // Frames go before their children.
      elements: [...scene, ...added, ...elements],
      // Manual placement can be undone; automatic placement stays out of anyone's undo history.
      captureUpdate: auto ? CaptureUpdateAction.NEVER : CaptureUpdateAction.IMMEDIATELY,
    })
    this.afterInsert()
  }

  /** "Platziert · Rückgängig" (PLAN.md 5.4, step 6): remove the elements, item back to the inbox. */
  async undo(placements: { itemId: string; elementIds: string[] }[], boardId: string) {
    const ids = new Set(placements.flatMap((placement) => placement.elementIds))
    this.excalidraw.updateScene({
      elements: this.excalidraw
        .getSceneElementsIncludingDeleted()
        .map((element) => (ids.has(element.id) ? newElementWith(element, { isDeleted: true }) : element)),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    await this.sync.sendNow([...ids])
    for (const placement of placements) await api.unplaceItem(placement.itemId, boardId)
  }
}
