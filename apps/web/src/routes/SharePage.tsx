import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Item } from '@wb/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { de } from '../i18n/de.ts'
import { api, assetUrl, formatBytes } from '../lib/api.ts'
import { refreshPendingShares } from '../lib/pwa.ts'
import { getShare, type QueuedShare, uploadShare } from '../sw/shareQueue.ts'
import { BoardPicker } from '../ui/BoardPicker.tsx'
import { itemIcon, itemTitle, previewAsset } from '../ui/itemDisplay.ts'
import { Button, FormMessage } from '../ui/kit.tsx'

type State =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'empty' }
  | { kind: 'unauthorized' }
  | { kind: 'waiting' }
  | { kind: 'failed'; tooLarge: boolean }
  | { kind: 'saved'; itemIds: string[] }
  | { kind: 'deleted' }

const SAVE_DELAY_MS = 600

/** What arrived from the share sheet, shown while it uploads. */
function SharePreview({ share }: { share: QueuedShare }) {
  const urls = useMemo(
    () => share.files.map((file) => (file.type.startsWith('image/') ? URL.createObjectURL(file.blob) : null)),
    [share],
  )
  useEffect(
    () => () => {
      for (const url of urls) if (url) URL.revokeObjectURL(url)
    },
    [urls],
  )
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--wb-border)] bg-[var(--wb-surface)] p-3 text-sm">
      {share.title && <div className="font-semibold break-words">{share.title}</div>}
      {share.text && <div className="line-clamp-4 break-words whitespace-pre-wrap">{share.text}</div>}
      {share.url && <div className="truncate text-[var(--wb-accent)]">{share.url}</div>}
      {share.files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {share.files.map((file, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: files of one share may share names
            <li key={index} className="flex items-center gap-2 rounded-lg bg-[var(--wb-hover)] p-1.5 pr-3">
              {urls[index] ? (
                <img src={urls[index] ?? ''} alt="" className="h-12 w-12 rounded object-cover" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center text-2xl">📎</span>
              )}
              <span className="max-w-40">
                <span className="block truncate">{file.name}</span>
                <span className="text-xs text-[var(--wb-muted)]">{formatBytes(file.size)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SavedItems({ items }: { items: Item[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => {
        const preview = previewAsset(item)
        return (
          <li key={item.id} className="flex items-center gap-2 text-sm">
            {preview ? (
              <img src={assetUrl(preview.id)} alt="" className="h-10 w-10 rounded object-cover" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center text-xl">{itemIcon(item)}</span>
            )}
            <span className="min-w-0 flex-1 truncate">{itemTitle(item)}</span>
            {item.processing === 'pending' && (
              <span className="text-xs text-[var(--wb-muted)]">{de.inbox.processing}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Edit title, note and board of a saved share; changes are saved debounced (PLAN.md 5.6). */
function EditShare({ itemIds, onDeleted }: { itemIds: string[]; onDeleted: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const items = useQuery({
    queryKey: ['share-items', itemIds.join(',')],
    queryFn: async () => (await api.itemsByIds(itemIds)).items,
    refetchInterval: (query) => (query.state.data?.some((item) => item.processing === 'pending') ? 2000 : false),
  })
  const first = items.data?.[0]
  const [title, setTitle] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [board, setBoard] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<unknown>(null)
  const [savedHint, setSavedHint] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Fields start from the first saved item.
  useEffect(() => {
    if (!first) return
    setTitle((current) => current ?? first.title ?? '')
    setNote((current) => current ?? first.note ?? '')
    setBoard((current) => (current === undefined ? first.targetBoardId : current))
  }, [first])

  const save = useCallback(
    (changes: { title?: string | null; note?: string | null; targetBoardId?: string | null }) => {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        Promise.all(itemIds.map((id) => api.updateItem(id, changes)))
          .then(() => {
            setError(null)
            void queryClient.invalidateQueries({ queryKey: ['items'] })
          })
          .catch(setError)
      }, SAVE_DELAY_MS)
    },
    [itemIds, queryClient],
  )
  useEffect(() => () => clearTimeout(timer.current), [])

  const remove = async () => {
    clearTimeout(timer.current)
    try {
      await Promise.all(itemIds.map((id) => api.trashItem(id)))
      onDeleted()
    } catch (failure) {
      setError(failure)
    }
  }

  const finish = () => {
    window.close()
    // Pages not opened by the share sheet cannot close themselves.
    setSavedHint(true)
    setTimeout(() => navigate('/?tab=inbox', { replace: true }), 1200)
  }

  return (
    <div className="flex flex-col gap-4">
      {items.data && <SavedItems items={items.data} />}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{de.share.titleField}</span>
        <input
          value={title ?? ''}
          onChange={(event) => {
            setTitle(event.target.value)
            save({ title: event.target.value.trim() || null })
          }}
          className="rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{de.share.noteField}</span>
        <textarea
          rows={3}
          value={note ?? ''}
          onChange={(event) => {
            setNote(event.target.value)
            save({ note: event.target.value.trim() || null })
          }}
          className="rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] px-3 py-2"
        />
      </label>
      <BoardPicker
        value={board ?? null}
        onChange={(boardId) => {
          setBoard(boardId)
          save({ targetBoardId: boardId })
        }}
      />
      <FormMessage error={error} success={savedHint ? de.share.doneHint : null} />
      <div className="sticky bottom-0 flex gap-2 bg-[var(--wb-bg)] py-3">
        <Button variant="danger" onClick={() => void remove()}>
          {de.share.delete}
        </Button>
        <Button variant="primary" className="flex-1" onClick={finish}>
          {de.share.done}
        </Button>
      </div>
    </div>
  )
}

/**
 * `/share` (PLAN.md 5.6): the service worker stored the share in IndexedDB; it is uploaded at once,
 * then title, note and board can be changed. Offline it waits for background sync.
 */
export function SharePage() {
  const [params] = useSearchParams()
  const location = useLocation()
  const shareId = params.get('id')
  const done = params.get('done')
  const [share, setShare] = useState<QueuedShare | null>(null)
  const [state, setState] = useState<State>({ kind: 'loading' })

  const run = useCallback(async () => {
    if (done) {
      setState({ kind: 'saved', itemIds: done.split(',').filter(Boolean) })
      return
    }
    if (params.get('empty') || !shareId) {
      setState({ kind: params.get('empty') ? 'empty' : 'not-found' })
      return
    }
    setState({ kind: 'loading' })
    try {
      const stored = await getShare(shareId)
      if (!stored) {
        setState({ kind: 'not-found' })
        return
      }
      setShare(stored)
      const result = await uploadShare(shareId)
      if (!result) setState({ kind: 'not-found' })
      else if (result.status === 'done') {
        setState(result.itemIds.length > 0 ? { kind: 'saved', itemIds: result.itemIds } : { kind: 'empty' })
      } else if (result.status === 'unauthorized') setState({ kind: 'unauthorized' })
      else if (result.status === 'failed') setState({ kind: 'failed', tooLarge: result.error === 'file_too_large' })
      else setState({ kind: 'waiting' })
      void refreshPendingShares()
    } catch {
      setState({ kind: 'waiting' })
    }
  }, [done, shareId, params])

  useEffect(() => {
    void run()
  }, [run])

  // Back online: try again.
  useEffect(() => {
    if (state.kind !== 'waiting') return
    const retry = () => void run()
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [state.kind, run])

  const loginLink = `/login?next=${encodeURIComponent(location.pathname + location.search)}`

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col gap-4 px-4 py-5">
      <h1 className="text-xl font-semibold">{de.share.title}</h1>
      {state.kind === 'loading' && <p className="text-[var(--wb-muted)]">{de.share.saving}</p>}
      {state.kind === 'saved' && <p className="font-medium text-[var(--wb-success)]">{de.share.saved}</p>}
      {state.kind === 'waiting' && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <p>{de.share.waiting}</p>
          <Button onClick={() => void run()}>{de.share.retry}</Button>
        </div>
      )}
      {state.kind === 'unauthorized' && (
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] p-3 text-sm">
          <p>{de.share.loginNeeded}</p>
          <Link to={loginLink} className="self-start rounded-lg bg-[var(--wb-accent)] px-3 py-1.5 text-white">
            {de.share.login}
          </Link>
        </div>
      )}
      {state.kind === 'failed' && <FormMessage error={state.tooLarge ? de.share.tooLarge : de.share.failed} />}
      {state.kind === 'not-found' && <p>{de.share.notFound}</p>}
      {state.kind === 'empty' && <p>{de.share.empty}</p>}
      {state.kind === 'deleted' && <p>{de.share.deleted}</p>}

      {share && state.kind !== 'saved' && state.kind !== 'deleted' && <SharePreview share={share} />}
      {state.kind === 'saved' && <EditShare itemIds={state.itemIds} onDeleted={() => setState({ kind: 'deleted' })} />}

      {state.kind !== 'saved' && (
        <Link to="/" className="text-sm text-[var(--wb-accent)]">
          {de.board.toDashboard}
        </Link>
      )}
    </div>
  )
}
