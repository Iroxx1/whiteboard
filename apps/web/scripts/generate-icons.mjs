// Generates the PWA icons (public/icons) without extra dependencies: a blue tile with a yellow
// sticky note. Run manually after changing the design: `node scripts/generate-icons.mjs`.
import fs from 'node:fs'
import zlib from 'node:zlib'

const BLUE = [76, 110, 245]
const YELLOW = [255, 236, 153]
const FOLD = [240, 200, 90]

function crc32(buffer) {
  let crc = ~0
  for (const byte of buffer) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size)
      const offset = y * (size * 4 + 1) + 1 + x * 4
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      raw[offset + 3] = a
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function insideRounded(u, v, inset, radius) {
  const min = inset
  const max = 1 - inset
  if (u < min || u > max || v < min || v > max) return false
  const cx = Math.min(Math.max(u, min + radius), max - radius)
  const cy = Math.min(Math.max(v, min + radius), max - radius)
  return (u - cx) ** 2 + (v - cy) ** 2 <= radius ** 2
}

// `scale` shrinks the note for the maskable variant (content must stay in the safe zone).
function icon(rounded, scale) {
  const noteMin = 0.5 - 0.3 * scale
  const noteMax = 0.5 + 0.3 * scale
  const fold = 0.16 * scale
  return (u, v) => {
    if (rounded && !insideRounded(u, v, 0, 0.18)) return [0, 0, 0, 0]
    if (u >= noteMin && u <= noteMax && v >= noteMin && v <= noteMax) {
      const dx = noteMax - u
      const dy = noteMax - v
      if (dx + dy < fold) return dx + dy < fold * 0.98 && dx < fold && dy < fold ? [...BLUE, 255] : [...FOLD, 255]
      if (dx + dy < fold * 1.6 && dx < fold && dy < fold) return [...FOLD, 255]
      return [...YELLOW, 255]
    }
    return [...BLUE, 255]
  }
}

const out = new URL('../public/icons/', import.meta.url)
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(new URL('icon-192.png', out), png(192, icon(true, 1)))
fs.writeFileSync(new URL('icon-512.png', out), png(512, icon(true, 1)))
fs.writeFileSync(new URL('icon-maskable-512.png', out), png(512, icon(false, 0.8)))
console.log('icons written')
