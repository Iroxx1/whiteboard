import { useQuery } from '@tanstack/react-query'
import { SEARCH_MARK_END, SEARCH_MARK_START, type SearchResult } from '@wb/shared'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { de } from '../i18n/de.ts'
import { api } from '../lib/api.ts'
import { useMe } from '../lib/auth.tsx'
import { itemIcon, itemTitle } from '../ui/itemDisplay.ts'
import { Dialog, FormMessage } from '../ui/kit.tsx'

const MIN_QUERY = 2
const DEBOUNCE_MS = 200

const SearchContext = createContext<{ open: () => void }>({ open: () => undefined })

/** Opens the search dialog (lupe buttons). */
export function useSearch() {
  return useContext(SearchContext)
}

/** Snippet with the server's markers turned into <mark> – the text itself is never HTML. */
export function Snippet({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let rest = text
  let key = 0
  while (rest.length > 0) {
    const start = rest.indexOf(SEARCH_MARK_START)
    if (start === -1) {
      parts.push(rest)
      break
    }
    const end = rest.indexOf(SEARCH_MARK_END, start)
    if (end === -1) {
      parts.push(rest.replace(SEARCH_MARK_START, ''))
      break
    }
    parts.push(rest.slice(0, start))
    parts.push(
      <mark key={key++} className="rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-700">
        {rest.slice(start + 1, end)}
      </mark>,
    )
    rest = rest.slice(end + 1)
  }
  return <>{parts}</>
}

type Hit = { key: string; group: 'items' | 'boards' | 'boardTexts'; go: () => void; node: ReactNode }

function hitsOf(result: SearchResult | undefined, navigate: (to: string) => void): Hit[] {
  if (!result) return []
  return [
    ...result.items.map(({ item, snippet }) => ({
      key: `i:${item.id}`,
      group: 'items' as const,
      go: () => navigate(`/i/${item.id}`),
      node: (
        <>
          <span className="text-lg">{itemIcon(item)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{itemTitle(item)}</span>
            {snippet && (
              <span className="line-clamp-2 text-xs text-[var(--wb-muted)]">
                <Snippet text={snippet} />
              </span>
            )}
          </span>
          {item.status !== 'inbox' && (
            <span className="shrink-0 text-xs text-[var(--wb-muted)]">{de.search.status[item.status]}</span>
          )}
        </>
      ),
    })),
    ...result.boards.map((board) => ({
      key: `b:${board.id}`,
      group: 'boards' as const,
      go: () => navigate(`/b/${board.id}`),
      node: (
        <>
          <span className="text-lg">🗂️</span>
          <span className="min-w-0 flex-1 truncate font-medium">{board.name}</span>
          <span className="text-xs text-[var(--wb-muted)]">#{board.hashtag}</span>
        </>
      ),
    })),
    ...result.boardTexts.map((hit) => ({
      key: `t:${hit.boardId}:${hit.elementId}`,
      group: 'boardTexts' as const,
      go: () => navigate(`/b/${hit.boardId}?focus=${encodeURIComponent(hit.elementId)}`),
      node: (
        <>
          <span className="text-lg">📝</span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2">
              <Snippet text={hit.snippet} />
            </span>
            <span className="block truncate text-xs text-[var(--wb-muted)]">{hit.boardName}</span>
          </span>
        </>
      ),
    })),
  ]
}

/**
 * Search dialog (PLAN.md 4.8, 5.9): lupe or Ctrl/Cmd+K, results grouped into "Inbox & Archiv",
 * "Boards" and "Auf Boards". Board texts open the board and jump to the element (?focus=).
 */
export function SearchProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const me = useMe()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const signedIn = Boolean(me.data)

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [input])

  // Capture phase: Excalidraw uses Ctrl+K for links; the search wins (PLAN.md 4.8).
  useEffect(() => {
    if (!signedIn) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [signedIn])

  const result = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.search(query),
    enabled: open && query.length >= MIN_QUERY,
    staleTime: 5_000,
  })

  const go = useCallback(
    (to: string) => {
      setOpen(false)
      navigate(to)
    },
    [navigate],
  )
  const hits = useMemo(() => hitsOf(result.data, go), [result.data, go])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const context = useMemo(() => ({ open: () => setOpen(true) }), [])
  const groups: Hit['group'][] = ['items', 'boards', 'boardTexts']

  return (
    <SearchContext.Provider value={context}>
      {children}
      <Dialog open={open} onOpenChange={setOpen} title={de.search.title} wide>
        <input
          autoFocus
          type="search"
          value={input}
          placeholder={de.search.placeholder}
          aria-label={de.search.title}
          onChange={(event) => {
            setInput(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((index) => Math.min(index + 1, hits.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((index) => Math.max(index - 1, 0))
            } else if (event.key === 'Enter') {
              hits[active]?.go()
            }
          }}
          className="mb-3 w-full rounded-lg border border-[var(--wb-border)] bg-[var(--wb-bg)] px-3 py-2"
        />
        <FormMessage error={result.error} />
        {query.length >= MIN_QUERY && result.data && hits.length === 0 && (
          <p className="text-sm text-[var(--wb-muted)]">{de.search.nothing}</p>
        )}
        {query.length < MIN_QUERY && <p className="text-sm text-[var(--wb-muted)]">{de.search.hint}</p>}
        <ul ref={listRef} className="flex flex-col gap-0.5">
          {groups.map((group) => {
            const inGroup = hits.filter((hit) => hit.group === group)
            if (inGroup.length === 0) return null
            return (
              <li key={group}>
                <div className="mt-2 mb-1 text-xs font-semibold tracking-wide text-[var(--wb-muted)] uppercase">
                  {de.search.groups[group]}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {inGroup.map((hit) => {
                    const index = hits.indexOf(hit)
                    return (
                      <li key={hit.key}>
                        <button
                          type="button"
                          data-index={index}
                          onClick={hit.go}
                          onMouseEnter={() => setActive(index)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${index === active ? 'bg-[var(--wb-hover)]' : ''}`}
                        >
                          {hit.node}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ul>
      </Dialog>
    </SearchContext.Provider>
  )
}

/** Lupe button for page headers. */
export function SearchButton({ className = '' }: { className?: string }) {
  const { open } = useSearch()
  return (
    <button
      type="button"
      onClick={open}
      title={de.search.buttonTitle}
      aria-label={de.search.title}
      className={`rounded-lg px-2 py-1 text-sm text-[var(--wb-muted)] hover:bg-[var(--wb-hover)] hover:text-[var(--wb-text)] ${className}`}
    >
      🔍
    </button>
  )
}
