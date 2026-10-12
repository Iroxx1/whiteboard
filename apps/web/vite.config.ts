import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const SERVER = 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      // The manifest is served dynamically by the server (PLAN.md 5.6).
      manifest: false,
      injectRegister: false,
      injectManifest: {
        // App shell and the fonts the UI needs. Excalidraw's lazy chunks and other fonts (e.g. the
        // large CJK font Xiaolai) are cached at runtime when first used (PLAN.md 5.6).
        globPatterns: [
          'index.html',
          'theme-init.js',
          'assets/index-*.{js,css}',
          'icons/*.png',
          'fonts/{Nunito,Excalifont,Assistant}/*.woff2',
        ],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': SERVER,
      '/healthz': SERVER,
      '/socket.io': { target: SERVER, ws: true },
      '/manifest.webmanifest': SERVER,
      '/share-target': SERVER,
    },
  },
  build: {
    target: 'es2023',
    sourcemap: true,
    chunkSizeWarningLimit: 4000,
  },
})
