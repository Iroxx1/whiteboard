// Image types Excalidraw accepts on the board, checked by their first bytes (PLAN.md 8.3:
// never trust the declared type). Full sniffing with `file-type` arrives with the inbox (Phase 2).

export const BOARD_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
  'image/x-icon',
  'image/svg+xml',
] as const

export type BoardImageType = (typeof BOARD_IMAGE_TYPES)[number]

const startsWith = (data: Buffer, bytes: number[], offset = 0) =>
  data.length >= offset + bytes.length && bytes.every((byte, i) => data[offset + i] === byte)

/** Returns the image type the content really has, or null if it is not a supported image. */
export function sniffBoardImage(data: Buffer): BoardImageType | null {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(data, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(data, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  if (startsWith(data, [0x42, 0x4d])) return 'image/bmp'
  if (startsWith(data, [0x66, 0x74, 0x79, 0x70], 4) && /^(avif|avis)$/.test(data.subarray(8, 12).toString('latin1'))) {
    return 'image/avif'
  }
  if (startsWith(data, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon'
  const head = data.subarray(0, 2048).toString('utf8').replace(/^﻿/, '').trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml'
  return null
}
