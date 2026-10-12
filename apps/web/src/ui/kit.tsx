// Small UI kit on top of Tailwind and Radix primitives (PLAN.md 5.13).
import * as RadixDialog from '@radix-ui/react-dialog'
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useId, useState } from 'react'
import { de } from '../i18n/de.ts'
import { ApiError } from '../lib/api.ts'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-[var(--wb-accent)] text-white hover:brightness-110 disabled:opacity-60',
  secondary:
    'border border-[var(--wb-border)] bg-[var(--wb-surface)] text-[var(--wb-text)] hover:bg-[var(--wb-hover)] disabled:opacity-60',
  danger: 'bg-[var(--wb-danger)] text-white hover:brightness-110 disabled:opacity-60',
  ghost: 'text-[var(--wb-accent)] hover:bg-[var(--wb-hover)] disabled:opacity-60',
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

export function TextField({
  label,
  hint,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId()
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        className="rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] px-3 py-2 text-[var(--wb-text)] outline-none focus:border-[var(--wb-accent)] focus:ring-2 focus:ring-[var(--wb-accent)]/30"
        {...props}
      />
      {hint && <p className="text-xs text-[var(--wb-muted)]">{hint}</p>}
    </div>
  )
}

/** German message for an API error. */
export function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return de.errors.unknown
  if (error.code === 'too_many_requests' && error.details.retryAfterSeconds) {
    return de.errors.retryAfter(error.details.retryAfterSeconds)
  }
  if (error.code === 'weak_password') {
    const reason = error.details.reason
    if (reason === 'too_short') return de.errors.weak_too_short
    if (reason === 'too_long') return de.errors.weak_too_long
    if (reason === 'common') return de.errors.weak_common
  }
  if (error.code in de.errors) {
    const text = de.errors[error.code as keyof typeof de.errors]
    if (typeof text === 'string') return text
  }
  return de.errors.unknown
}

export function FormMessage({ error, success }: { error?: unknown; success?: string | null }) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-[var(--wb-danger)]">
        {typeof error === 'string' ? error : errorText(error)}
      </p>
    )
  }
  if (success) return <p className="text-sm text-[var(--wb-success)]">{success}</p>
  return null
}

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--wb-border)] bg-[var(--wb-surface)] p-4 shadow-sm">
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RadixDialog.Content
          className={`fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-[var(--wb-surface)] p-5 text-[var(--wb-text)] shadow-xl ${wide ? 'max-w-xl' : 'max-w-md'}`}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <RadixDialog.Title className="mb-1 text-lg font-semibold">{title}</RadixDialog.Title>
          {description && (
            <RadixDialog.Description className="mb-3 text-sm text-[var(--wb-muted)]">
              {description}
            </RadixDialog.Description>
          )}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

/** Shows a one-time link with a copy button. */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex gap-2">
      <input
        readOnly
        value={url}
        onFocus={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 rounded-lg border border-[var(--wb-border)] bg-[var(--wb-bg)] px-2 py-1.5 font-mono text-xs"
      />
      <Button
        variant="primary"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => setCopied(true))
        }}
      >
        {copied ? de.common.copied : de.common.copy}
      </Button>
    </div>
  )
}

/** Centered card for login, setup, invite and reset. */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-[var(--wb-border)] bg-[var(--wb-surface)] p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
          <span className="font-semibold text-[var(--wb-muted)]">{de.appName}</span>
        </div>
        <h1 className="mb-4 text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  )
}
