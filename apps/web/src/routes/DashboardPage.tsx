import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type BoardSummary, normalizeHashtag } from '@wb/shared'
import { type FormEvent, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { de } from '../i18n/de.ts'
import { api } from '../lib/api.ts'
import { formatRelative } from '../lib/format.ts'
import { Button, Card, Dialog, FormMessage, TextField } from '../ui/kit.tsx'
import { Layout } from '../ui/Layout.tsx'

export const BOARDS_KEY = ['boards'] as const
const TRASH_KEY = ['boards', 'trash'] as const

type Sort = 'recent' | 'name'

function BoardForm({ board, onDone }: { board?: BoardSummary; onDone: (board: BoardSummary) => void }) {
  const [name, setName] = useState(board?.name ?? '')
  const [hashtag, setHashtag] = useState(board?.hashtag ?? '')
  // Until the user edits the hashtag, it follows the name (PLAN.md 5.5, decided 12.10.2026).
  const [hashtagEdited, setHashtagEdited] = useState(Boolean(board))
  const save = useMutation({
    mutationFn: () =>
      board ? api.updateBoard(board.id, { name, hashtag }) : api.createBoard({ name, hashtag: hashtag || name }),
    onSuccess: onDone,
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <TextField
        label={de.boardForm.name}
        required
        autoFocus
        maxLength={80}
        value={name}
        onChange={(event) => {
          setName(event.target.value)
          if (!hashtagEdited) setHashtag(normalizeHashtag(event.target.value))
        }}
      />
      <TextField
        label={de.boardForm.hashtag}
        hint={de.boardForm.hashtagHint}
        required
        value={hashtag ? `#${hashtag}` : ''}
        onChange={(event) => {
          setHashtagEdited(true)
          setHashtag(normalizeHashtag(event.target.value))
        }}
      />
      <FormMessage error={save.error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={save.isPending || !name.trim() || !hashtag}>
          {board ? de.common.save : de.boardForm.create}
        </Button>
      </div>
    </form>
  )
}

function BoardTile({ board, onRename, onDelete }: { board: BoardSummary; onRename: () => void; onDelete: () => void }) {
  return (
    <li className="group relative rounded-xl border border-[var(--wb-border)] bg-[var(--wb-surface)] shadow-sm transition hover:border-[var(--wb-accent)]">
      <Link to={`/b/${board.id}`} className="block p-4 pr-10">
        <div className="truncate font-semibold">{board.name}</div>
        <div className="truncate text-sm text-[var(--wb-accent)]">#{board.hashtag}</div>
        <div className="mt-2 text-xs text-[var(--wb-muted)]">
          {de.dashboard.changed(formatRelative(board.updatedAt), board.updatedByName)}
        </div>
      </Link>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={de.dashboard.menu}
          className="absolute top-2 right-2 rounded-md px-2 py-1 text-[var(--wb-muted)] hover:bg-[var(--wb-hover)]"
        >
          ⋯
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            className="z-50 min-w-40 rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] p-1 text-sm text-[var(--wb-text)] shadow-lg"
          >
            <DropdownMenu.Item
              onSelect={onRename}
              className="cursor-pointer rounded px-2 py-1.5 outline-none data-[highlighted]:bg-[var(--wb-hover)]"
            >
              {de.dashboard.rename}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={onDelete}
              className="cursor-pointer rounded px-2 py-1.5 text-[var(--wb-danger)] outline-none data-[highlighted]:bg-[var(--wb-hover)]"
            >
              {de.dashboard.toTrash}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </li>
  )
}

function Trash() {
  const queryClient = useQueryClient()
  const trash = useQuery({ queryKey: TRASH_KEY, queryFn: () => api.boards(true) })
  const restore = useMutation({
    mutationFn: api.restoreBoard,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BOARDS_KEY }),
  })
  return (
    <Card title={de.dashboard.trash}>
      <p className="mb-3 text-sm text-[var(--wb-muted)]">{de.dashboard.trashHint}</p>
      {trash.data?.length === 0 && <p className="text-sm text-[var(--wb-muted)]">{de.dashboard.trashEmpty}</p>}
      <ul className="divide-y divide-[var(--wb-border)]">
        {trash.data?.map((board) => (
          <li key={board.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{board.name}</div>
              <div className="text-xs text-[var(--wb-muted)]">
                #{board.hashtag} · {de.dashboard.deletedAt(formatRelative(board.deletedAt ?? 0))}
              </div>
            </div>
            <Button onClick={() => restore.mutate(board.id)} disabled={restore.isPending}>
              {de.dashboard.restore}
            </Button>
          </li>
        ))}
      </ul>
      <FormMessage error={restore.error} />
    </Card>
  )
}

export function DashboardPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const boards = useQuery({ queryKey: BOARDS_KEY, queryFn: () => api.boards() })
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<BoardSummary | null>(null)
  const [showTrash, setShowTrash] = useState(false)
  const remove = useMutation({
    mutationFn: api.deleteBoard,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BOARDS_KEY }),
  })

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    const list = (boards.data ?? []).filter(
      (board) => !term || board.name.toLowerCase().includes(term) || board.hashtag.includes(normalizeHashtag(term)),
    )
    return sort === 'name'
      ? list.toSorted((a, b) => a.name.localeCompare(b.name, 'de'))
      : list.toSorted((a, b) => b.updatedAt - a.updatedAt)
  }, [boards.data, search, sort])

  return (
    <Layout>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">{de.dashboard.title}</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + {de.dashboard.newBoard}
        </Button>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          placeholder={de.dashboard.search}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] px-3 py-1.5"
        />
        <select
          aria-label={de.dashboard.sortLabel}
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
          className="rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] px-2 py-1.5 text-sm"
        >
          <option value="recent">{de.dashboard.sortRecent}</option>
          <option value="name">{de.dashboard.sortName}</option>
        </select>
      </div>

      {boards.isPending && <p className="text-[var(--wb-muted)]">{de.common.loading}</p>}
      <FormMessage error={boards.error ?? remove.error} />
      {boards.data?.length === 0 && <p className="text-[var(--wb-muted)]">{de.dashboard.empty}</p>}
      {boards.data && boards.data.length > 0 && visible.length === 0 && (
        <p className="text-[var(--wb-muted)]">{de.dashboard.noMatch}</p>
      )}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((board) => (
          <BoardTile
            key={board.id}
            board={board}
            onRename={() => setRenaming(board)}
            onDelete={() => remove.mutate(board.id)}
          />
        ))}
      </ul>

      <div className="mt-8">
        <Button variant="ghost" onClick={() => setShowTrash((value) => !value)} aria-expanded={showTrash}>
          🗑 {de.dashboard.trash}
        </Button>
        {showTrash && (
          <div className="mt-2">
            <Trash />
          </div>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating} title={de.boardForm.createTitle}>
        <BoardForm
          onDone={(board) => {
            setCreating(false)
            void queryClient.invalidateQueries({ queryKey: BOARDS_KEY })
            navigate(`/b/${board.id}`)
          }}
        />
      </Dialog>
      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title={de.boardForm.editTitle}
      >
        {renaming && (
          <BoardForm
            board={renaming}
            onDone={() => {
              setRenaming(null)
              void queryClient.invalidateQueries({ queryKey: BOARDS_KEY })
            }}
          />
        )}
      </Dialog>
    </Layout>
  )
}
