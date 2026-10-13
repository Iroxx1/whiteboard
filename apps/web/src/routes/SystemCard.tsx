import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { de } from '../i18n/de.ts'
import { api, formatBytes } from '../lib/api.ts'
import { formatDateTime, formatRelative } from '../lib/format.ts'
import { Button, Card, FormMessage } from '../ui/kit.tsx'

export const SYSTEM_KEY = ['admin-system']

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-[var(--wb-muted)]">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

const ok = (good: boolean, text: string) => (
  <span className={good ? 'text-[var(--wb-success)]' : 'text-[var(--wb-danger)]'}>{text}</span>
)

/** Admin page "System" (PLAN.md 7.7): version, storage, backups, jobs, Telegram, e-mail. */
export function SystemCard() {
  const queryClient = useQueryClient()
  const system = useQuery({ queryKey: SYSTEM_KEY, queryFn: api.system, refetchInterval: 30_000 })
  const refresh = () => queryClient.invalidateQueries({ queryKey: SYSTEM_KEY })
  const retry = useMutation({ mutationFn: (id?: string) => api.retryJobs(id), onSuccess: refresh })
  const backup = useMutation({ mutationFn: api.backupNow, onSuccess: refresh })
  const data = system.data
  if (!data) return <FormMessage error={system.error} />
  const t = de.admin

  return (
    <Card title={t.system}>
      <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <Row label={t.version}>
          <span className="font-mono">{data.version}</span>
        </Row>
        <Row label={t.content}>{t.counts(data.users, data.boards, data.items)}</Row>
        <Row label={t.storageLabel}>
          {ok(
            !data.storage.warning,
            t.storageFree(formatBytes(data.storage.freeBytes), Math.round(data.storage.freeShare * 100)),
          )}
          <span className="text-[var(--wb-muted)]">
            {' '}
            · {t.storageUsed(formatBytes(data.dbBytes), formatBytes(data.filesBytes))}
          </span>
        </Row>
        <Row label={t.backupLabel}>
          <div className="flex flex-wrap items-center gap-2">
            {data.lastBackup
              ? ok(
                  Date.now() - data.lastBackup.at < 36 * 60 * 60 * 1000,
                  t.backupAt(formatDateTime(data.lastBackup.at), formatBytes(data.lastBackup.bytes)),
                )
              : ok(false, t.backupNone)}
            <Button onClick={() => backup.mutate()} disabled={backup.isPending}>
              {t.backupNow}
            </Button>
          </div>
        </Row>
        <Row label={t.jobsLabel}>
          <div className="flex flex-wrap items-center gap-2">
            <span>{t.jobs(data.jobs.queued, data.jobs.running)}</span>
            {data.jobs.failed > 0 && (
              <>
                {ok(false, t.jobsFailed(data.jobs.failed))}
                <Button onClick={() => retry.mutate(undefined)} disabled={retry.isPending}>
                  {t.retryAll}
                </Button>
              </>
            )}
          </div>
          {data.jobs.failures.length > 0 && (
            <ul className="mt-1 flex flex-col gap-1">
              {data.jobs.failures.map((job) => (
                <li key={job.id} className="flex items-center gap-2 text-xs">
                  <span className="font-mono">{job.type}</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--wb-muted)]" title={job.lastError ?? ''}>
                    {job.finishedAt ? `${formatRelative(job.finishedAt)} · ` : ''}
                    {job.lastError}
                  </span>
                  <Button onClick={() => retry.mutate(job.id)} disabled={retry.isPending}>
                    {t.retry}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row label="Telegram">
          {!data.telegram.configured
            ? t.off
            : ok(
                data.telegram.connected && data.telegram.polling,
                data.telegram.connected && data.telegram.polling
                  ? t.telegramOn(data.telegram.username ?? '')
                  : t.telegramDown,
              )}
        </Row>
        <Row label={t.emailLabel}>
          {!data.email.configured ? (
            t.off
          ) : (
            <span>
              {data.email.address ?? ''} · {t.emailWeek(data.email.accepted7d, data.email.rejected7d)}
              {data.email.failed7d > 0 && <> · {ok(false, t.emailFailed(data.email.failed7d))}</>}
            </span>
          )}
        </Row>
      </dl>
      <FormMessage error={retry.error ?? backup.error} />
    </Card>
  )
}
