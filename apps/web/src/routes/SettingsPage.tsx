import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TelegramLinkCode } from '@wb/shared'
import { PASSWORD_MIN_LENGTH } from '@wb/shared'
import QRCode from 'qrcode'
import { type FormEvent, useEffect, useState } from 'react'
import { de } from '../i18n/de.ts'
import { api } from '../lib/api.ts'
import { ME_KEY, useMe } from '../lib/auth.tsx'
import { formatRelative } from '../lib/format.ts'
import { useMediaQuery } from '../lib/useMediaQuery.ts'
import { Button, Card, FormMessage, TextField } from '../ui/kit.tsx'
import { Layout } from '../ui/Layout.tsx'
import { ThemeToggle } from '../ui/ThemeToggle.tsx'

/** Short, readable device name from a user agent ("Chrome · Android"). */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return de.settings.unknownDevice
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : null
  const os = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null
  return [browser, os].filter(Boolean).join(' · ') || de.settings.unknownDevice
}

function Profile() {
  const me = useMe()
  const queryClient = useQueryClient()
  const [name, setName] = useState(me.data?.name ?? '')
  const save = useMutation({
    mutationFn: () => api.updateMe({ name }),
    onSuccess: (updated) => queryClient.setQueryData(ME_KEY, updated),
  })
  return (
    <Card title={de.settings.profile}>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          save.mutate()
        }}
        className="flex flex-col gap-3"
      >
        <TextField label={de.common.email} value={me.data?.email ?? ''} readOnly disabled />
        <TextField
          label={de.common.name}
          required
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{de.theme.label}</span>
          <div>
            <ThemeToggle />
          </div>
        </div>
        <FormMessage error={save.error} success={save.isSuccess ? de.settings.nameSaved : null} />
        <div>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {de.common.save}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function PasswordChange() {
  const queryClient = useQueryClient()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const change = useMutation({
    mutationFn: () => api.changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent('')
      setNext('')
      setRepeat('')
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
  })
  return (
    <Card title={de.settings.password}>
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          setMismatch(next !== repeat)
          if (next === repeat) change.mutate()
        }}
        className="flex flex-col gap-3"
      >
        <TextField
          label={de.settings.currentPassword}
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <TextField
          label={de.settings.newPassword}
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          hint={de.common.passwordHint}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <TextField
          label={de.common.passwordRepeat}
          type="password"
          autoComplete="new-password"
          required
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
        <FormMessage
          error={mismatch ? de.common.passwordMismatch : change.error}
          success={change.isSuccess ? de.settings.passwordChanged : null}
        />
        <div>
          <Button type="submit" variant="primary" disabled={change.isPending}>
            {de.common.save}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function Sessions() {
  const queryClient = useQueryClient()
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions })
  const revoke = useMutation({
    mutationFn: api.revokeSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  })
  return (
    <Card title={de.settings.sessions}>
      <ul className="divide-y divide-[var(--wb-border)]">
        {sessions.data?.map((session) => (
          <li key={session.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0 text-sm">
              <div className="font-medium">
                {describeDevice(session.userAgent)}
                {session.current && (
                  <span className="ml-2 text-xs text-[var(--wb-success)]">({de.settings.thisDevice})</span>
                )}
              </div>
              <div className="text-xs text-[var(--wb-muted)]">
                {de.settings.lastSeen(formatRelative(session.lastSeenAt))}
                {session.ip ? ` · ${session.ip}` : ''}
              </div>
            </div>
            {!session.current && (
              <Button onClick={() => revoke.mutate(session.id)} disabled={revoke.isPending}>
                {de.settings.signOut}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <FormMessage error={sessions.error ?? revoke.error} />
    </Card>
  )
}

/** QR code of the deep link for linking from the PC with the phone (PLAN.md 5.7). */
function QrImage({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    QRCode.toDataURL(url, { margin: 1, width: 200 }).then(
      (data) => active && setSrc(data),
      () => active && setSrc(null),
    )
    return () => {
      active = false
    }
  }, [url])
  return src ? <img src={src} alt="" width={200} height={200} className="rounded bg-white p-1" /> : null
}

/** Settings → "Telegram verbinden" (PLAN.md 5.7): one-time deep link, then wait until linked. */
function Telegram() {
  const queryClient = useQueryClient()
  const desktop = useMediaQuery('(min-width: 768px) and (pointer: fine)')
  const [link, setLink] = useState<TelegramLinkCode | null>(null)
  const [now, setNow] = useState(Date.now())
  const status = useQuery({
    queryKey: ['telegram'],
    queryFn: api.telegram,
    // While a link is shown: notice when the bot linked the account.
    refetchInterval: link ? 3000 : false,
  })
  const linked = status.data?.linked ?? null
  useEffect(() => {
    if (linked) setLink(null)
  }, [linked])
  useEffect(() => {
    if (!link) return
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [link])
  const create = useMutation({
    mutationFn: api.telegramLinkCode,
    onSuccess: (code) => {
      setNow(Date.now())
      setLink(code)
    },
  })
  const unlink = useMutation({
    mutationFn: api.telegramUnlink,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['telegram'] }),
  })
  const expired = link !== null && now > link.expiresAt

  return (
    <Card title={de.settings.telegram}>
      {status.data && !status.data.enabled && (
        <p className="text-sm text-[var(--wb-muted)]">{de.settings.telegramOff}</p>
      )}
      {status.data?.enabled && linked && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            {de.settings.telegramLinked(
              status.data.botUsername ?? '',
              linked.username,
              formatRelative(linked.linkedAt),
            )}
          </p>
          <Button onClick={() => unlink.mutate()} disabled={unlink.isPending}>
            {de.settings.telegramDisconnect}
          </Button>
        </div>
      )}
      {status.data?.enabled && !linked && (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{de.settings.telegramIntro}</p>
          {link && !expired ? (
            <>
              <p className="text-sm text-[var(--wb-muted)]">{de.settings.telegramSteps}</p>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="self-start rounded-lg bg-[var(--wb-accent)] px-3 py-1.5 text-sm text-white"
              >
                {de.settings.telegramOpen}
              </a>
              {desktop && (
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-[var(--wb-muted)]">{de.settings.telegramQr}</span>
                  <QrImage url={link.url} />
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              {expired && <p className="text-sm text-[var(--wb-muted)]">{de.settings.telegramExpired}</p>}
              <div>
                <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
                  {de.settings.telegramConnect}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      <FormMessage error={status.error ?? create.error ?? unlink.error} />
    </Card>
  )
}

export function SettingsPage() {
  return (
    <Layout>
      <h1 className="mb-4 text-2xl font-semibold">{de.settings.title}</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Profile />
        <PasswordChange />
        <div className="md:col-span-2">
          <Telegram />
        </div>
        <div className="md:col-span-2">
          <Sessions />
        </div>
      </div>
    </Layout>
  )
}
