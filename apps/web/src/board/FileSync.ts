import { CaptureUpdateAction, newElementWith } from '@excalidraw/excalidraw'
import type { ExcalidrawElement, ExcalidrawImageElement, FileId } from '@excalidraw/excalidraw/element/types'
import type { BinaryFileData, BinaryFiles, DataURL, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { ApiError, api as http } from '../lib/api.ts'

const MAX_FETCH_ATTEMPTS = 6

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const header = dataUrl.slice(0, comma)
  const mime = /^data:([^;,]+)/.exec(header)?.[1] ?? 'application/octet-stream'
  const body = dataUrl.slice(comma + 1)
  if (!header.endsWith(';base64')) return new Blob([decodeURIComponent(body)], { type: mime })
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function blobToDataUrl(blob: Blob): Promise<DataURL> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as DataURL)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

const isImage = (element: ExcalidrawElement): element is ExcalidrawImageElement =>
  element.type === 'image' && !element.isDeleted

/**
 * Board images (PLAN.md 5.3): new files from onChange are uploaded once per fileId and then marked
 * `saved`; images whose file is missing locally are fetched from the server and added.
 */
export class FileSync {
  private readonly onServer = new Set<string>()
  private readonly uploading = new Set<string>()
  private readonly fetching = new Set<string>()
  /** Rejected uploads are not retried on every change (the user sees one message). */
  private readonly failed = new Set<string>()
  private stopped = false

  constructor(
    private readonly boardId: string,
    private readonly api: ExcalidrawImperativeAPI,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** Called from Excalidraw's onChange. */
  handleFiles(files: BinaryFiles) {
    for (const file of Object.values(files)) {
      if (this.onServer.has(file.id) || this.uploading.has(file.id) || this.failed.has(file.id)) continue
      void this.upload(file)
    }
  }

  private async upload(file: BinaryFileData) {
    this.uploading.add(file.id)
    try {
      await http.uploadBoardFile(this.boardId, file.id, dataUrlToBlob(file.dataURL))
      this.onServer.add(file.id)
      this.markSaved(file.id)
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) this.failed.add(file.id)
      if (!this.stopped) this.onError(error)
    } finally {
      this.uploading.delete(file.id)
    }
  }

  private markSaved(fileId: string) {
    if (this.stopped) return
    const elements = this.api.getSceneElementsIncludingDeleted()
    if (!elements.some((element) => isImage(element) && element.fileId === fileId && element.status !== 'saved')) return
    this.api.updateScene({
      elements: elements.map((element) =>
        isImage(element) && element.fileId === fileId && element.status !== 'saved'
          ? newElementWith(element, { status: 'saved' })
          : element,
      ),
      captureUpdate: CaptureUpdateAction.NEVER,
    })
  }

  /** Fetches files of image elements that are not loaded yet. */
  ensureFiles(elements: readonly ExcalidrawElement[]) {
    const loaded = this.api.getFiles()
    for (const element of elements) {
      if (!isImage(element) || !element.fileId) continue
      const id = element.fileId
      if (loaded[id] || this.fetching.has(id) || this.uploading.has(id)) continue
      void this.fetch(id)
    }
  }

  private async fetch(fileId: FileId) {
    this.fetching.add(fileId)
    try {
      for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS && !this.stopped; attempt++) {
        const response = await fetch(`/api/files/${encodeURIComponent(fileId)}`, { credentials: 'same-origin' })
        if (response.ok) {
          const blob = await response.blob()
          this.onServer.add(fileId)
          if (this.stopped) return
          this.api.addFiles([
            {
              id: fileId,
              mimeType: blob.type as BinaryFileData['mimeType'],
              dataURL: await blobToDataUrl(blob),
              created: Date.now(),
            },
          ])
          return
        }
        // The uploader may still be busy; try again with growing pauses (1, 2, 4 … s).
        if (response.status !== 404) throw new ApiError(response.status, 'unknown')
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
      }
    } catch {
      // Excalidraw shows a placeholder for the image; nothing else to do.
    } finally {
      this.fetching.delete(fileId)
    }
  }

  stop() {
    this.stopped = true
  }
}
