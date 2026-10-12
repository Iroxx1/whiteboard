import type { ShareReport } from '@wb/shared'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { de } from '../i18n/de.ts'
import { api } from '../lib/api.ts'
import { ShareReportView } from '../ui/ShareReportView.tsx'
import { ThemeToggle } from '../ui/ThemeToggle.tsx'

type InstallPromptEvent = Event & { prompt: () => Promise<void> }

export function HomePage() {
  const [access, setAccess] = useState<boolean | null>(null)
  const [reports, setReports] = useState<ShareReport[]>([])
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null)

  const load = useCallback(async () => {
    try {
      const { ok } = await api.access()
      setAccess(ok)
      if (ok) setReports((await api.reports()).reports)
    } catch {
      setAccess(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [load])

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{de.appName}</h1>
        <ThemeToggle />
      </header>

      <p className="mb-4 text-[var(--wb-muted)]">{de.home.intro}</p>

      {access === false && (
        <p className="mb-4 rounded-lg border border-amber-400 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {de.home.accessMissing}
        </p>
      )}
      {access === true && <p className="mb-4 text-sm text-green-700 dark:text-green-400">{de.home.accessOk}</p>}

      <section className="mb-6 rounded-xl border border-[var(--wb-border)] bg-[var(--wb-surface)] p-4">
        <h2 className="mb-1 text-lg font-semibold">{de.home.spikeA}</h2>
        <p className="mb-3 text-sm text-[var(--wb-muted)]">{de.home.spikeAText}</p>
        <p className="mb-3 text-sm text-[var(--wb-muted)]">{de.home.installHint}</p>
        {installEvent && (
          <button
            type="button"
            onClick={() => void installEvent.prompt()}
            className="mb-3 rounded-lg bg-[var(--wb-accent)] px-3 py-1.5 text-white"
          >
            {de.home.install}
          </button>
        )}
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium">{de.home.reports}</h3>
          <button type="button" onClick={() => void load()} className="text-sm text-[var(--wb-accent)]">
            {de.home.reload}
          </button>
        </div>
        {reports.length === 0 ? (
          <p className="text-sm text-[var(--wb-muted)]">{de.home.noReports}</p>
        ) : (
          <ul className="space-y-3">
            {reports.map((report) => (
              <li key={report.id}>
                <ShareReportView report={report} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-[var(--wb-border)] bg-[var(--wb-surface)] p-4">
        <h2 className="mb-1 text-lg font-semibold">{de.home.spikeB}</h2>
        <p className="mb-3 text-sm text-[var(--wb-muted)]">{de.home.spikeBText}</p>
        <Link to="/spike/excalidraw" className="inline-block rounded-lg bg-[var(--wb-accent)] px-3 py-1.5 text-white">
          {de.home.openSpikeB}
        </Link>
      </section>
    </div>
  )
}
