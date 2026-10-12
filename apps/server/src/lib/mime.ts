import path from 'node:path'
import type { ItemKind } from '@wb/shared'
import { fileTypeFromFile } from 'file-type'

// Text-based formats file-type cannot detect (no magic bytes); recognised by extension only.
const TEXT_EXTENSIONS: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  log: 'text/plain',
  ics: 'text/calendar',
  vcf: 'text/vcard',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  svg: 'image/svg+xml',
}

const OFFICE = /^application\/(msword|rtf|vnd\.(ms-|openxmlformats|oasis\.opendocument))/

export function extensionOf(filename: string): string {
  return path.extname(filename).slice(1).toLowerCase()
}

/** MIME type from the content (PLAN.md 5.5); falls back to the extension for plain text formats. */
export async function sniffFile(file: string, filename: string): Promise<string> {
  const detected = await fileTypeFromFile(file)
  const ext = extensionOf(filename)
  if (detected) {
    // Office formats are ZIP/CFB containers; file-type usually tells them apart, the extension helps.
    if (detected.mime === 'application/zip' && ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(ext)) {
      return `application/vnd.${ext.startsWith('o') ? 'oasis.opendocument' : 'openxmlformats'}.${ext}`
    }
    return detected.mime
  }
  return TEXT_EXTENSIONS[ext] ?? 'application/octet-stream'
}

/** Inbox kind for a sniffed MIME type (PLAN.md 4.7). SVG stays a file: it is never rendered inline. */
export function kindForMime(mime: string): ItemKind {
  if (mime === 'image/svg+xml') return 'file'
  if (/^image\/(jpeg|png|gif|webp|avif|heic|heif|bmp|tiff)$/.test(mime)) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('text/') || mime === 'application/json' || OFFICE.test(mime)) return 'document'
  return 'file'
}

export function isTextMime(mime: string): boolean {
  return mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml'
}

/** Safe file name for storage and Content-Disposition: no paths, no control or odd characters. */
export function sanitizeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '')
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/["*:<>?|]/g, '_')
    .replace(/^\.+/, '')
    .trim()
  const limited = base.length > 120 ? base.slice(0, 100) + base.slice(base.lastIndexOf('.')).slice(0, 20) : base
  return limited || 'datei'
}

/** ASCII-only variant for file paths on disk. */
export function diskFilename(name: string): string {
  return (
    sanitizeFilename(name)
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 100) || 'datei'
  )
}
