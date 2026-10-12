import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Me } from '@wb/shared'
import { type ReactNode, useCallback, useEffect } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { de } from '../i18n/de.ts'
import { ApiError, api } from './api.ts'
import { applyStoredTheme } from './theme.ts'

export const ME_KEY = ['me'] as const

export function useMe() {
  return useQuery<Me, ApiError>({ queryKey: ME_KEY, queryFn: api.me, retry: false, staleTime: 5 * 60_000 })
}

/** Stores a freshly signed-in user and applies their theme. */
export function useSignedIn() {
  const queryClient = useQueryClient()
  return useCallback(
    (me: Me) => {
      queryClient.setQueryData(ME_KEY, me)
      applyStoredTheme(me.theme)
    },
    [queryClient],
  )
}

export function useLogout() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useCallback(async () => {
    try {
      await api.logout()
    } finally {
      queryClient.clear()
      navigate('/login', { replace: true })
    }
  }, [queryClient, navigate])
}

/** Only `/path?query` within this app, so `next` cannot redirect elsewhere. */
export function safeNext(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export function FullPageMessage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-full items-center justify-center p-6 text-[var(--wb-muted)]">{children}</div>
}

/** Renders children for signed-in users; otherwise redirects to the login with a way back. */
export function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const me = useMe()
  const location = useLocation()

  useEffect(() => {
    if (me.data) applyStoredTheme(me.data.theme)
  }, [me.data])

  if (me.isPending) return <FullPageMessage>{de.common.loading}</FullPageMessage>
  if (me.error) {
    if (me.error.status === 401) {
      const next = encodeURIComponent(location.pathname + location.search)
      return <Navigate to={`/login?next=${next}`} replace />
    }
    return <FullPageMessage>{de.errors.network}</FullPageMessage>
  }
  if (admin && me.data.role !== 'admin') return <Navigate to="/" replace />
  return children
}

export function isUnauthorized(error: unknown) {
  return error instanceof ApiError && error.status === 401
}
