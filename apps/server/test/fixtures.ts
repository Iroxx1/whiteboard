import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

/** True if a command-line tool is installed (ffmpeg, pdftoppm …). In CI all of them must exist. */
export function hasTool(command: string, args = ['-version']): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' })
    return true
  } catch {
    if (process.env.CI) throw new Error(`${command} is required in CI`)
    return false
  }
}

/** JPEG 300×200 with EXIF orientation 6 (rotate 90°) and GPS-like metadata. */
export async function jpegWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 300, height: 200, channels: 3, background: '#4c6ef5' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '54/1 19/1 0/1' } })
    .withMetadata({ orientation: 6 })
    .toBuffer()
}

/** Minimal valid one-page PDF with the text "Hallo Whiteboard". */
export function tinyPdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const stream = 'BT /F1 18 Tf 20 100 Td (Hallo Whiteboard) Tj ET'
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

/** Generates a short test clip with ffmpeg. */
export function ffmpegClip(kind: 'audio' | 'video'): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-clip-'))
  const file = path.join(dir, kind === 'audio' ? 'clip.ogg' : 'clip.mp4')
  const input =
    kind === 'audio'
      ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libopus']
      : ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10', '-pix_fmt', 'yuv420p']
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...input, file])
  const data = fs.readFileSync(file)
  fs.rmSync(dir, { recursive: true, force: true })
  return data
}

export function multipart(fields: Record<string, string>, files: { name: string; type: string; data: Buffer }[]) {
  const boundary = `----wb${Date.now()}`
  const parts: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  for (const file of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    )
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

/** Screenshot-like PNG with dark text on white (for OCR). */
export async function textImage(lines: string[]): Promise<Buffer> {
  const rows = lines
    .map(
      (line, index) =>
        `<text x="40" y="${90 + index * 70}" font-family="DejaVu Sans, Arial, sans-serif" font-size="48" fill="#111">${line}</text>`,
    )
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${120 + lines.length * 70}"><rect width="100%" height="100%" fill="#fff"/>${rows}</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** One-page PDF that only contains a JPEG (like a scan, no text layer). */
export function scannedPdf(jpeg: Buffer, width: number, height: number): Buffer {
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im1 Do Q`
  const parts: (string | Buffer)[] = []
  const offsets: number[] = []
  let length = 0
  const add = (chunk: string | Buffer) => {
    parts.push(chunk)
    length += typeof chunk === 'string' ? Buffer.byteLength(chunk, 'latin1') : chunk.length
  }
  add('%PDF-1.4\n')
  const object = (index: number, body: (string | Buffer)[]) => {
    offsets[index] = length
    add(`${index} 0 obj\n`)
    for (const chunk of body) add(chunk)
    add('\nendobj\n')
  }
  object(1, ['<< /Type /Catalog /Pages 2 0 R >>'])
  object(2, ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'])
  object(3, [
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>`,
  ])
  object(4, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`])
  object(5, [
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    '\nendstream',
  ])
  const xref = length
  add(`xref\n0 6\n0000000000 65535 f \n`)
  for (let index = 1; index <= 5; index++) add(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`)
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return Buffer.concat(parts.map((chunk) => (typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk)))
}
