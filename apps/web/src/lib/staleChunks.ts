// After an update, a tab that was open before still references the old build's lazy chunks
// (e.g. Excalidraw's image code), which no longer exist on the server. Reload once to get the new
// build. The guard prevents a reload loop if a chunk is missing for another reason.
// The "new version available" prompt follows in Phase 3 (PLAN.md 5.6).

const KEY = 'wb.staleChunkReloadAt'
const MIN_INTERVAL_MS = 60_000

export function shouldReload(lastReloadAt: number | null, now: number): boolean {
  return lastReloadAt === null || now - lastReloadAt > MIN_INTERVAL_MS
}

export function isChunkLoadError(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason ?? '')
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    message,
  )
}

function reloadOnce() {
  let last: number | null = null
  try {
    const stored = sessionStorage.getItem(KEY)
    last = stored ? Number(stored) : null
  } catch {
    // Without storage we still reload, the browser keeps us from looping fast enough.
  }
  const now = Date.now()
  if (!shouldReload(last, now)) return
  try {
    sessionStorage.setItem(KEY, String(now))
  } catch {
    // ignore
  }
  window.location.reload()
}

export function installStaleChunkReload() {
  // Vite reports failed dynamic imports with this event.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    reloadOnce()
  })
  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason)) reloadOnce()
  })
}
