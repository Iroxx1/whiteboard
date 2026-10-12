import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { de } from '../i18n/de.ts'
import { useLogout, useMe } from '../lib/auth.tsx'
import { InstallHint } from './PwaBanners.tsx'
import { ThemeToggle } from './ThemeToggle.tsx'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-2.5 py-1.5 text-sm ${isActive ? 'bg-[var(--wb-hover)] font-medium text-[var(--wb-text)]' : 'text-[var(--wb-muted)] hover:text-[var(--wb-text)]'}`

/** Page frame for everything except the board editor. */
export function Layout({ children }: { children: ReactNode }) {
  const me = useMe()
  const logout = useLogout()
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-[var(--wb-border)] bg-[var(--wb-surface)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
          <NavLink to="/" className="mr-2 flex items-center gap-2 font-semibold">
            <img src="/icons/icon-192.png" alt="" className="h-7 w-7 rounded-md" />
            {de.appName}
          </NavLink>
          <nav className="flex flex-1 flex-wrap items-center gap-1">
            <NavLink to="/" end className={linkClass}>
              {de.nav.boards}
            </NavLink>
            <NavLink to="/settings" className={linkClass}>
              {de.nav.settings}
            </NavLink>
            {me.data?.role === 'admin' && (
              <NavLink to="/admin" className={linkClass}>
                {de.nav.admin}
              </NavLink>
            )}
          </nav>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => void logout()}
            className="text-sm text-[var(--wb-muted)] hover:text-[var(--wb-text)]"
          >
            {de.nav.logout}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <InstallHint />
        {children}
      </main>
    </div>
  )
}
