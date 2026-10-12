import { useQuery } from '@tanstack/react-query'
import type { ShareReport } from '@wb/shared'
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { de } from '../i18n/de.ts'
import { ApiError, api } from '../lib/api.ts'
import { getShare, putShare, type QueuedShare } from '../sw/shareQueue.ts'
import { Button } from '../ui/kit.tsx'
import { ShareReportView } from '../ui/ShareReportView.tsx'

type State =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'no-access' }
  | { kind: 'waiting' }
  | { kind: 'done'; report: ShareReport }

function RecentReports() {
  const reports = useQuery({ queryKey: ['share-reports'], queryFn: api.reports })
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-medium">{de.share.reports}</h2>
        <Button variant="ghost" onClick={() => void reports.refetch()}>
          {de.share.reload}
        </Button>
      </div>
      {reports.data?.reports.length === 0 && <p className="text-sm text-[var(--wb-muted)]">{de.share.noReports}</p>}
      <ul className="space-y-3">
        {reports.data?.reports.map((report) => (
          <li key={report.id}>
            <ShareReportView report={report} />
          </li>
        ))}
      </ul>
    </section>
  )
}

// Spike A test page (until Phase 3): shows what the share sheet delivered and sends it to the server.
export function SharePage() {
  const [params] = useSearchParams()
  const location = useLocation()
  const shareId = params.get('id')
  const reportId = params.get('report')
  const [state, setState] = useState<State>({ kind: 'loading' })

  const upload = useCallback(async (share: QueuedShare) => {
    const form = new FormData()
    form.set('via', 'service-worker')
    if (share.title) form.set('title', share.title)
    if (share.text) form.set('text', share.text)
    if (share.url) form.set('url', share.url)
    for (const file of share.files) form.append('files', file.blob, file.name)
    const report = await api.sendShare(form)
    await putShare({ ...share, status: 'uploaded', reportId: report.id })
    setState({ kind: 'done', report })
  }, [])

  const run = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      if (reportId) {
        setState({ kind: 'done', report: await api.report(reportId) })
        return
      }
      const share = shareId ? await getShare(shareId) : undefined
      if (!share) {
        setState({ kind: 'not-found' })
        return
      }
      if (share.status === 'uploaded' && share.reportId) {
        setState({ kind: 'done', report: await api.report(share.reportId) })
        return
      }
      await upload(share)
    } catch (error) {
      setState(error instanceof ApiError && error.status === 401 ? { kind: 'no-access' } : { kind: 'waiting' })
    }
  }, [reportId, shareId, upload])

  useEffect(() => {
    if (shareId || reportId) void run()
  }, [run, shareId, reportId])

  const loginLink = `/login?next=${encodeURIComponent(location.pathname + location.search)}`

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-2 text-xl font-semibold">{de.share.title}</h1>
      <p className="mb-4 text-sm text-[var(--wb-muted)]">{de.share.phaseNote}</p>
      {!shareId && !reportId ? (
        <RecentReports />
      ) : (
        <>
          {state.kind === 'loading' && <p className="text-[var(--wb-muted)]">{de.share.saving}</p>}
          {state.kind === 'not-found' && <p>{de.share.notFound}</p>}
          {state.kind === 'no-access' && (
            <p className="text-amber-700 dark:text-amber-300">
              {de.share.noAccess}{' '}
              <Link to={loginLink} className="text-[var(--wb-accent)] underline">
                {de.login.submit}
              </Link>
            </p>
          )}
          {state.kind === 'waiting' && (
            <div className="space-y-3">
              <p className="text-amber-700 dark:text-amber-300">{de.share.waiting}</p>
              <Button variant="primary" onClick={() => void run()}>
                {de.share.retry}
              </Button>
            </div>
          )}
          {state.kind === 'done' && (
            <div className="space-y-3">
              <p className="font-medium text-green-700 dark:text-green-400">{de.share.saved}</p>
              <ShareReportView report={state.report} />
            </div>
          )}
        </>
      )}
      <Link to="/" className="mt-6 inline-block text-[var(--wb-accent)]">
        {de.share.back}
      </Link>
    </div>
  )
}
