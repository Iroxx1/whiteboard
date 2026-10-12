import { useMutation, useQuery } from '@tanstack/react-query'
import { PASSWORD_MIN_LENGTH } from '@wb/shared'
import { type FormEvent, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { de } from '../i18n/de.ts'
import { api } from '../lib/api.ts'
import { safeNext, useMe, useSignedIn } from '../lib/auth.tsx'
import { AuthLayout, Button, FormMessage, TextField } from '../ui/kit.tsx'

function useAfterSignIn(next = '/') {
  const signedIn = useSignedIn()
  const navigate = useNavigate()
  return (me: Parameters<typeof signedIn>[0]) => {
    signedIn(me)
    navigate(next, { replace: true })
  }
}

export function LoginPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const me = useMe()
  const status = useQuery({ queryKey: ['auth-status'], queryFn: api.status })
  const done = useAfterSignIn(next)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const login = useMutation({ mutationFn: api.login, onSuccess: done })

  if (me.data) return <Navigate to={next} replace />

  const submit = (event: FormEvent) => {
    event.preventDefault()
    login.mutate({ email, password })
  }

  return (
    <AuthLayout title={de.login.title}>
      {status.data?.setupRequired && <p className="mb-4 text-sm text-[var(--wb-muted)]">{de.login.setupHint}</p>}
      <form onSubmit={submit} className="flex flex-col gap-3">
        <TextField
          label={de.common.email}
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label={de.common.password}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <FormMessage error={login.error} />
        <Button type="submit" variant="primary" disabled={login.isPending}>
          {de.login.submit}
        </Button>
        <p className="text-xs text-[var(--wb-muted)]">{de.login.forgot}</p>
      </form>
    </AuthLayout>
  )
}

type AccountValues = { name: string; email: string; password: string }

/** Name, e-mail and password twice; used by setup and invite. */
function AccountForm({
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  submitLabel: string
  pending: boolean
  error: unknown
  onSubmit: (values: AccountValues) => void
}) {
  const [values, setValues] = useState({ name: '', email: '', password: '', repeat: '' })
  const [mismatch, setMismatch] = useState(false)
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (values.password !== values.repeat) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    onSubmit({ name: values.name, email: values.email, password: values.password })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <TextField
        label={de.common.name}
        autoComplete="name"
        required
        maxLength={60}
        value={values.name}
        onChange={set('name')}
      />
      <TextField
        label={de.common.email}
        type="email"
        autoComplete="username"
        required
        value={values.email}
        onChange={set('email')}
      />
      <TextField
        label={de.common.password}
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        hint={de.common.passwordHint}
        value={values.password}
        onChange={set('password')}
      />
      <TextField
        label={de.common.passwordRepeat}
        type="password"
        autoComplete="new-password"
        required
        value={values.repeat}
        onChange={set('repeat')}
      />
      <FormMessage error={mismatch ? de.common.passwordMismatch : error} />
      <Button type="submit" variant="primary" disabled={pending}>
        {submitLabel}
      </Button>
    </form>
  )
}

export function SetupPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const done = useAfterSignIn()
  const setup = useMutation({ mutationFn: (values: AccountValues) => api.setup({ ...values, token }), onSuccess: done })

  return (
    <AuthLayout title={de.setup.title}>
      {token ? (
        <>
          <p className="mb-4 text-sm text-[var(--wb-muted)]">{de.setup.intro}</p>
          <AccountForm
            submitLabel={de.setup.submit}
            pending={setup.isPending}
            error={setup.error}
            onSubmit={setup.mutate}
          />
        </>
      ) : (
        <FormMessage error={de.setup.missingToken} />
      )}
    </AuthLayout>
  )
}

export function InvitePage() {
  const { token = '' } = useParams()
  const done = useAfterSignIn()
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api.invite(token), retry: false })
  const accept = useMutation({
    mutationFn: (values: AccountValues) => api.acceptInvite(token, values),
    onSuccess: done,
  })

  return (
    <AuthLayout title={de.invite.title}>
      {invite.isPending && <p className="text-[var(--wb-muted)]">{de.common.loading}</p>}
      {invite.error && <FormMessage error={invite.error} />}
      {invite.data && (
        <>
          <p className="mb-2 text-sm">{de.invite.intro}</p>
          <p className="mb-4 rounded-lg bg-[var(--wb-hover)] p-2 text-xs text-[var(--wb-muted)]">{de.invite.shared}</p>
          {invite.data.role === 'admin' && <p className="mb-4 text-sm">{de.invite.roleAdmin}</p>}
          <AccountForm
            submitLabel={de.invite.submit}
            pending={accept.isPending}
            error={accept.error}
            onSubmit={accept.mutate}
          />
        </>
      )}
    </AuthLayout>
  )
}

export function ResetPage() {
  const { token = '' } = useParams()
  const done = useAfterSignIn()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const reset = useMutation({ mutationFn: (value: string) => api.resetPassword(token, value), onSuccess: done })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setMismatch(password !== repeat)
    if (password === repeat) reset.mutate(password)
  }

  return (
    <AuthLayout title={de.reset.title}>
      <p className="mb-4 text-sm text-[var(--wb-muted)]">{de.reset.intro}</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <TextField
          label={de.common.password}
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          hint={de.common.passwordHint}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <TextField
          label={de.common.passwordRepeat}
          type="password"
          autoComplete="new-password"
          required
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
        />
        <FormMessage error={mismatch ? de.common.passwordMismatch : reset.error} />
        <Button type="submit" variant="primary" disabled={reset.isPending}>
          {de.reset.submit}
        </Button>
      </form>
    </AuthLayout>
  )
}
