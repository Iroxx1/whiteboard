import { exportToBlob } from '@excalidraw/excalidraw'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { BinaryFiles } from '@excalidraw/excalidraw/types'
import { api } from '../lib/api.ts'

/** Quiet time after the last change before a new preview is rendered and uploaded. */
const IDLE_MS = 30_000
/** Rendered size (the server scales it down to its tile size anyway). */
const MAX_SIZE = 800

const signatureOf = (elements: readonly OrderedExcalidrawElement[]) => {
  let sum = 0
  let count = 0
  for (const element of elements) {
    if (element.isDeleted) continue
    sum += element.version
    count += 1
  }
  return `${count}:${sum}`
}

/**
 * Keeps the dashboard preview of a board current (Phase 10): the browser renders the scene with
 * Excalidraw's own export and uploads it; the server only stores a re-encoded copy. Rendering
 * happens after 30 s without changes and when leaving the board, never while someone is drawing.
 */
export class ThumbnailSaver {
  private elements: readonly OrderedExcalidrawElement[] = []
  private files: BinaryFiles = {}
  private uploaded: string | null = null
  private dirty: boolean
  private timer: ReturnType<typeof setTimeout> | undefined
  private busy = false

  /** `missing`: the board has no preview yet, so one is made even without a change. */
  constructor(
    private readonly boardId: string,
    missing: boolean,
    /** Called after a successful upload, e.g. to refresh the dashboard list. */
    private readonly onUploaded: () => void = () => {},
  ) {
    this.dirty = missing
  }

  /** Called with every Excalidraw change; cheap when nothing visible changed. */
  update(elements: readonly OrderedExcalidrawElement[], files: BinaryFiles) {
    this.elements = elements
    this.files = files
    const signature = signatureOf(elements)
    if (this.uploaded === null) {
      // The first call is the loaded scene: a preview exists unless the board never had one.
      this.uploaded = signature
      if (!this.dirty) return
    } else if (signature === this.uploaded) {
      return
    } else {
      this.dirty = true
    }
    this.schedule()
  }

  private schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), IDLE_MS)
  }

  /** Renders and uploads now if something changed; failures are ignored (the next change retries). */
  async flush() {
    clearTimeout(this.timer)
    if (!this.dirty || this.busy) return
    const elements = this.elements.filter((element) => !element.isDeleted)
    if (elements.length === 0) {
      this.dirty = false
      return
    }
    this.busy = true
    const signature = signatureOf(this.elements)
    try {
      const blob = await exportToBlob({
        elements,
        files: this.files,
        mimeType: 'image/png',
        maxWidthOrHeight: MAX_SIZE,
        appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false },
      })
      await api.uploadBoardThumbnail(this.boardId, blob)
      this.uploaded = signature
      this.dirty = false
      this.onUploaded()
    } catch {
      // Not important enough to bother anyone; the next change tries again.
    } finally {
      this.busy = false
    }
  }

  stop() {
    clearTimeout(this.timer)
    void this.flush()
  }
}
