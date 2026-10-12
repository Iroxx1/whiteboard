import type { ThemePreference } from '@wb/shared'
import { useCallback, useSyncExternalStore } from 'react'

export type { ThemePreference }
export type ResolvedTheme = 'light' | 'dark'

// Keep in sync with public/theme-init.js.
const STORAGE_KEY = 'wb.theme'
const listeners = new Set<() => void>()

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

export function parsePreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}

function readPreference(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'system'
  }
}

const media = typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)')

function snapshot(): string {
  return `${readPreference()}|${media?.matches ? 'dark' : 'light'}`
}

function apply() {
  const theme = resolveTheme(readPreference(), media?.matches ?? false)
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onChange = () => {
    apply()
    listener()
  }
  media?.addEventListener('change', onChange)
  return () => {
    listeners.delete(listener)
    media?.removeEventListener('change', onChange)
  }
}

export function useTheme() {
  const value = useSyncExternalStore(subscribe, snapshot, () => 'system|light')
  const [preference, system] = value.split('|') as [ThemePreference, ResolvedTheme]
  const setPreference = useCallback((next: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private mode: the choice simply is not remembered.
    }
    apply()
    for (const listener of listeners) listener()
  }, [])
  return { preference, theme: resolveTheme(preference, system === 'dark'), setPreference }
}

/** Applies the theme stored in the user's account (PLAN.md 5.13); the server wins at sign-in. */
export function applyStoredTheme(preference: ThemePreference) {
  try {
    if (localStorage.getItem(STORAGE_KEY) === preference) return
    localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    return
  }
  apply()
  for (const listener of listeners) listener()
}
