import { de } from '../i18n/de.ts'

const TIME_ZONE = 'Europe/Berlin'
const dateTime = new Intl.DateTimeFormat('de-DE', { timeZone: TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' })
const dateOnly = new Intl.DateTimeFormat('de-DE', { timeZone: TIME_ZONE, dateStyle: 'medium' })
const timeOnly = new Intl.DateTimeFormat('de-DE', { timeZone: TIME_ZONE, timeStyle: 'short' })
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE })

export function formatDateTime(ms: number): string {
  return dateTime.format(ms)
}

export function formatDate(ms: number): string {
  return dateOnly.format(ms)
}

/** "gerade eben", "vor 5 Min.", "vor 3 Std.", "gestern 14:02", otherwise the date. */
export function formatRelative(ms: number, now = Date.now()): string {
  const diff = now - ms
  if (diff < 60_000) return de.time.justNow
  if (diff < 60 * 60_000) return de.time.minutesAgo(Math.floor(diff / 60_000))
  if (dayKey.format(ms) === dayKey.format(now)) return de.time.hoursAgo(Math.floor(diff / (60 * 60_000)))
  if (dayKey.format(ms) === dayKey.format(now - 24 * 60 * 60_000)) return `${de.time.yesterday} ${timeOnly.format(ms)}`
  return dateOnly.format(ms)
}
