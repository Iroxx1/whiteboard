import { useQuery } from '@tanstack/react-query'
import { normalizeHashtag } from '@wb/shared'
import { useMemo, useState } from 'react'
import { de } from '../i18n/de.ts'
import { api } from '../lib/api.ts'

// "Zuletzt gewählte Boards" live on this device only (decided 12.10.2026).
const RECENT_KEY = 'wb.recentBoards'
const RECENT_MAX = 5

export function recentBoardIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function rememberBoard(boardId: string) {
  try {
    const next = [boardId, ...recentBoardIds().filter((id) => id !== boardId)].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Private mode: not remembered.
  }
}

/** Board choice: "Nur Inbox", recently chosen boards, then all boards with search (PLAN.md 5.6). */
export function BoardPicker({
  value,
  onChange,
  label = de.share.board,
}: {
  value: string | null
  onChange: (boardId: string | null) => void
  label?: string
}) {
  const boards = useQuery({ queryKey: ['boards'], queryFn: () => api.boards() })
  const [search, setSearch] = useState('')
  const recent = useMemo(() => {
    const byId = new Map((boards.data ?? []).map((board) => [board.id, board]))
    return recentBoardIds().flatMap((boardId) => byId.get(boardId) ?? [])
  }, [boards.data])
  const term = search.trim().toLowerCase()
  const filtered = (boards.data ?? []).filter(
    (board) => !term || board.name.toLowerCase().includes(term) || board.hashtag.includes(normalizeHashtag(term)),
  )
  const choose = (boardId: string | null) => {
    if (boardId) rememberBoard(boardId)
    onChange(boardId)
  }
  const option = (boardId: string | null, text: string, hint?: string) => (
    <button
      key={boardId ?? 'inbox'}
      type="button"
      aria-pressed={value === boardId}
      onClick={() => choose(boardId)}
      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
        value === boardId
          ? 'border-[var(--wb-accent)] bg-[var(--wb-accent)] text-white'
          : 'border-[var(--wb-border)] bg-[var(--wb-surface)]'
      }`}
    >
      <span className="truncate">{text}</span>
      {hint && (
        <span className={`ml-2 text-xs ${value === boardId ? 'text-white/80' : 'text-[var(--wb-muted)]'}`}>{hint}</span>
      )}
    </button>
  )
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      {option(null, de.share.onlyInbox)}
      {recent.length > 0 && (
        <>
          <span className="mt-1 text-xs text-[var(--wb-muted)]">{de.share.recent}</span>
          {recent.map((board) => option(board.id, board.name, `#${board.hashtag}`))}
        </>
      )}
      <span className="mt-1 text-xs text-[var(--wb-muted)]">{de.share.allBoards}</span>
      <input
        type="search"
        placeholder={de.share.searchBoards}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] px-3 py-1.5 text-sm"
      />
      <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
        {filtered
          .filter((board) => !recent.some((entry) => entry.id === board.id) || term)
          .map((board) => option(board.id, board.name, `#${board.hashtag}`))}
      </div>
    </fieldset>
  )
}
