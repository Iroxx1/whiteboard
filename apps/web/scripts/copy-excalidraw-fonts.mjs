// Copies Excalidraw's fonts into public/fonts so they are self-hosted (no CDN, strict CSP;
// PLAN.md 5.13). The app sets window.EXCALIDRAW_ASSET_PATH = "/".
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(import.meta.resolve('@excalidraw/excalidraw'))
const source = path.join(path.dirname(entry), 'fonts')
const target = fileURLToPath(new URL('../public/fonts', import.meta.url))

if (!fs.existsSync(source)) {
  throw new Error(`Excalidraw fonts not found at ${source}`)
}
fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(source, target, { recursive: true })
console.log(`copied Excalidraw fonts to ${path.relative(process.cwd(), target)}`)
