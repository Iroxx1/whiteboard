import type { ShareReport } from '@wb/shared'
import { de } from '../i18n/de.ts'
import { formatBytes } from '../lib/api.ts'

function Field({ name, value }: { name: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[4rem_1fr] gap-2">
      <dt className="font-mono text-[var(--wb-muted)]">{name}</dt>
      <dd className="break-all whitespace-pre-wrap">
        {value ?? <em className="text-[var(--wb-muted)]">{de.share.empty}</em>}
      </dd>
    </div>
  )
}

export function ShareReportView({ report }: { report: ShareReport }) {
  return (
    <div className="rounded-lg border border-[var(--wb-border)] p-3 text-sm">
      <div className="mb-2 text-xs text-[var(--wb-muted)]">
        {new Date(report.receivedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} · {de.share.via}{' '}
        {report.via === 'service-worker' ? de.share.viaSw : de.share.viaServer}
      </div>
      <dl className="space-y-1">
        <Field name="title" value={report.title} />
        <Field name="text" value={report.text} />
        <Field name="url" value={report.url} />
        <div className="grid grid-cols-[4rem_1fr] gap-2">
          <dt className="font-mono text-[var(--wb-muted)]">files</dt>
          <dd>
            {report.files.length === 0 ? (
              <em className="text-[var(--wb-muted)]">{de.share.noFiles}</em>
            ) : (
              <ul className="space-y-0.5">
                {report.files.map((file, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static list, files may share names
                  <li key={index} className="break-all">
                    {file.name} · <span className="font-mono">{file.type || '(kein Typ)'}</span> ·{' '}
                    {formatBytes(file.size)}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </div>
  )
}
