import { useSyncExternalStore } from 'react'
import { pendingCount, pruneShares, uploadPending } from '../sw/shareQueue.ts'

// PWA state for the pages (PLAN.md 5.6): a waiting service worker ("Neue Version verfügbar"), the
// install prompt on Android and shares that still wait for their upload.

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

type State = { updateReady: boolean; installPrompt: InstallPromptEvent | null; pendingShares: number }

let state: State = { updateReady: false, installPrompt: null, pendingShares: 0 }
let waiting: ServiceWorker | null = null
const listeners = new Set<() => void>()

function set(next: Partial<State>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export function usePwa(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
    () => state,
  )
}

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

/** Uploads shares that are still waiting and updates the counter. */
export async function refreshPendingShares() {
  try {
    await uploadPending()
    await pruneShares()
    set({ pendingShares: await pendingCount() })
  } catch {
    // IndexedDB unavailable (private mode): nothing queued.
  }
}

export function applyUpdate() {
  if (!waiting) return
  waiting.postMessage({ type: 'SKIP_WAITING' })
}

function watchWaiting(registration: ServiceWorkerRegistration) {
  const offer = (worker: ServiceWorker | null) => {
    // Only an update (a controller exists) needs the prompt; the first install activates directly.
    if (worker && navigator.serviceWorker.controller) {
      waiting = worker
      set({ updateReady: true })
    }
  }
  offer(registration.waiting)
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed') offer(installing)
    })
  })
}

export function setupPwa() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    set({ installPrompt: event as InstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => set({ installPrompt: null }))
  window.addEventListener('online', () => void refreshPendingShares())

  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The new version took over after "neu laden".
    if (reloading || !waiting) return
    reloading = true
    window.location.reload()
  })
  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((registration) => {
      watchWaiting(registration)
      // Long-open apps (installed PWA) look for updates every hour.
      setInterval(() => void registration.update().catch(() => undefined), 60 * 60 * 1000)
    })
    .catch((error: unknown) => console.error('service worker registration failed', error))
  // Upload what is still waiting on every app start (PLAN.md 5.6).
  void refreshPendingShares()
}
