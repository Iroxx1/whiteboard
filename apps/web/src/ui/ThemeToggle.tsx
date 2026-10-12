import { useQueryClient } from '@tanstack/react-query'
import type { Me } from '@wb/shared'
import { useCallback } from 'react'
import { de } from '../i18n/de.ts'
import { api } from '../lib/api.ts'
import { ME_KEY } from '../lib/auth.tsx'
import { type ThemePreference, useTheme } from '../lib/theme.ts'

export const THEME_ORDER: ThemePreference[] = ['system', 'light', 'dark']

/** Changes the theme locally right away and stores it in the account (PLAN.md 5.13). */
export function useThemeSetting() {
  const { preference, theme, setPreference } = useTheme()
  const queryClient = useQueryClient()
  const change = useCallback(
    (next: ThemePreference) => {
      setPreference(next)
      const me = queryClient.getQueryData<Me>(ME_KEY)
      if (!me) return
      queryClient.setQueryData<Me>(ME_KEY, { ...me, theme: next })
      api.updateMe({ theme: next }).catch(() => {
        // Stays local until the next change; not worth bothering the user.
      })
    },
    [queryClient, setPreference],
  )
  return { preference, theme, setPreference: change }
}

export function ThemeToggle() {
  const { preference, setPreference } = useThemeSetting()
  return (
    <fieldset
      className="inline-flex rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] p-0.5 text-sm"
      aria-label={de.theme.label}
    >
      {THEME_ORDER.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={preference === value}
          onClick={() => setPreference(value)}
          className={`rounded-md px-2.5 py-1 transition-colors ${
            preference === value
              ? 'bg-[var(--wb-accent)] text-white'
              : 'text-[var(--wb-muted)] hover:text-[var(--wb-text)]'
          }`}
        >
          {de.theme[value]}
        </button>
      ))}
    </fieldset>
  )
}
