import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './index.css'
import { setupPwa } from './lib/pwa.ts'
import { installStaleChunkReload } from './lib/staleChunks.ts'

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

// Excalidraw loads its fonts from here (self-hosted copies in public/fonts).
window.EXCALIDRAW_ASSET_PATH = '/'

installStaleChunkReload()

setupPwa()

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
