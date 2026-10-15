/** Helpers for pasting or dropping links and PDFs onto the board (Phase 10). */

/** The text is exactly one http(s) address (nothing else, no spaces): then it becomes a link item. */
export function urlFromText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || /\s/.test(trimmed) || trimmed.length > 2048) return null
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

/** Every file is a PDF (mixed drops stay with Excalidraw, which handles images itself). */
export function onlyPdfs(files: readonly File[]): File[] | null {
  return files.length > 0 && files.every(isPdf) ? [...files] : null
}

/** First address in a dragged link: `text/uri-list` has one per line, comments start with #. */
export function urlFromUriList(list: string): string | null {
  const first = list.split(/\r?\n/).find((line) => line.trim() && !line.startsWith('#'))
  return first ? urlFromText(first) : null
}

/** Typing into a field (Excalidraw's text editor, our dialogs): pasting there is plain text. */
export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
  )
}
