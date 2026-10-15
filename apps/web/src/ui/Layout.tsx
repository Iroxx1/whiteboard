import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { de } from '../i18n/de.ts'
import { api, formatBytes } from '../lib/api.ts'
import { useLogout, useMe } from '../lib/auth.tsx'
import { SearchButton } from '../search/SearchDialog.tsx'
import { InstallHint } from './PwaBanners.tsx'
import { THEME_ORDER, ThemeToggle, useThemeSetting } from './ThemeToggle.tsx'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-2.5 py-1.5 text-sm ${isActive ? 'bg-[var(--wb-hover)] font-medium text-[var(--wb-text)]' : 'text-[var(--wb-muted)] hover:text-[var(--wb-text)]'}`

const menuItem =
  'flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-base outline-none data-[highlighted]:bg-[var(--wb-hover)]'

/** Admins only: warning below 15 % free space (PLAN.md 7.7). */
function StorageWarning() {
  const system = useQuery({ queryKey: ['admin-system'], queryFn: api.system, staleTime: 5 * 60_000 })
  const space = system.data?.storage
  if (!space?.warning) return null
  return (
    <div className="mb-4 rounded-lg border border-[var(--wb-danger)] p-3 text-sm text-[var(--wb-danger)]">
      {de.admin.storageWarning(formatBytes(space.freeBytes), Math.round(space.freeShare * 100))}
    </div>
  )
}

/** Phones: one menu button instead of a row of links (pages, theme, sign out). */
function MobileMenu({ admin }: { admin: boolean }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const logout = useLogout()
  const { preference, setPreference } = useThemeSetting()
  const pages = [
    { to: '/', label: de.nav.boards },
    { to: '/settings', label: de.nav.settings },
    ...(admin ? [{ to: '/admin', label: de.nav.admin }] : []),
  ]
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={de.nav.menu}
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] text-xl leading-none text-[var(--wb-text)] hover:bg-[var(--wb-hover)]"
      >
        ☰
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border border-[var(--wb-border)] bg-[var(--wb-surface)] p-1.5 text-[var(--wb-text)] shadow-xl"
        >
          {pages.map((page) => (
            <DropdownMenu.Item key={page.to} onSelect={() => navigate(page.to)} className={menuItem}>
              <span className={pathname === page.to ? 'font-semibold' : ''}>{page.label}</span>
              {pathname === page.to && <span className="text-[var(--wb-accent)]">●</span>}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1.5 h-px bg-[var(--wb-border)]" />
          <DropdownMenu.Label className="px-3 pt-1 text-xs text-[var(--wb-muted)]">{de.theme.label}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={preference}
            onValueChange={(value) => setPreference(value as (typeof THEME_ORDER)[number])}
          >
            {THEME_ORDER.map((value) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                onSelect={(e) => e.preventDefault()}
                className={menuItem}
              >
                {de.theme[value]}
                <DropdownMenu.ItemIndicator className="text-[var(--wb-accent)]">✓</DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1.5 h-px bg-[var(--wb-border)]" />
          <DropdownMenu.Item onSelect={() => void logout()} className={menuItem}>
            {de.nav.logout}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** Page frame for everything except the board editor. */
export function Layout({ children }: { children: ReactNode }) {
  const me = useMe()
  const logout = useLogout()
  const admin = me.data?.role === 'admin'
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-[var(--wb-border)] bg-[var(--wb-surface)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2 sm:gap-3">
          <NavLink to="/" className="mr-auto flex min-w-0 items-center gap-2 font-semibold sm:mr-2">
            <img src="/icons/icon-192.png" alt="" className="h-8 w-8 shrink-0 rounded-md sm:h-7 sm:w-7" />
            <span className="truncate">{de.appName}</span>
          </NavLink>
          {/* Wide screens: the links, theme switch and sign-out in one row. */}
          <nav className="hidden flex-1 items-center gap-1 sm:flex">
            <NavLink to="/" end className={linkClass}>
              {de.nav.boards}
            </NavLink>
            <NavLink to="/settings" className={linkClass}>
              {de.nav.settings}
            </NavLink>
            {admin && (
              <NavLink to="/admin" className={linkClass}>
                {de.nav.admin}
              </NavLink>
            )}
          </nav>
          <SearchButton className="flex h-10 w-10 items-center justify-center text-base sm:h-auto sm:w-auto" />
          <div className="hidden items-center gap-3 sm:flex">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => void logout()}
              className="text-sm whitespace-nowrap text-[var(--wb-muted)] hover:text-[var(--wb-text)]"
            >
              {de.nav.logout}
            </button>
          </div>
          <div className="sm:hidden">
            <MobileMenu admin={admin} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <InstallHint />
        {admin && <StorageWarning />}
        {children}
      </main>
    </div>
  )
}
