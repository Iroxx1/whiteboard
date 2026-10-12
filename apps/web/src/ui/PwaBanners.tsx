import { useState } from 'react'
import { de } from '../i18n/de.ts'
import { applyUpdate, isStandalone, usePwa } from '../lib/pwa.ts'
import { Button } from './kit.tsx'

/** "Neue Version verfügbar – neu laden" (PLAN.md 5.6), on every page including boards. */
export function UpdateBanner() {
  const { updateReady } = usePwa()
  if (!updateReady) return null
  return (
    <div
      role="status"
      className="fixed bottom-3 left-3 z-[100] flex items-center gap-3 rounded-lg bg-[#1e1e24] px-4 py-2 text-sm text-white shadow-lg"
    >
      {de.pwa.update}
      <button type="button" onClick={applyUpdate} className="font-semibold text-[#9db0ff] underline">
        {de.pwa.reload}
      </button>
    </div>
  )
}

const DISMISS_KEY = 'wb.installHintDismissed'

/** Install hint on Android browsers that offer installation (PLAN.md 5.6 "Installation"). */
export function InstallHint() {
  const { installPrompt } = usePwa()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })
  if (!installPrompt || dismissed || isStandalone()) return null
  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // ignore
    }
  }
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-xl border border-[var(--wb-accent)] bg-[var(--wb-surface)] p-3 text-sm">
      <p>{de.pwa.installHint}</p>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => void installPrompt.prompt().finally(dismiss)}>
          {de.pwa.install}
        </Button>
        <Button variant="ghost" onClick={dismiss}>
          {de.pwa.later}
        </Button>
      </div>
    </div>
  )
}
