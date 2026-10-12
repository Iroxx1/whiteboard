import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Item, ItemStatus } from '@wb/shared'
import { type FormEvent, useMemo, useState } from 'react'
import { de } from '../i18n/de.ts'
import { api, assetUrl } from '../lib/api.ts'
import { itemIcon, itemSubline, itemTitle, previewAsset } from '../ui/itemDisplay.ts'
import { Button, Dialog, FormMessage, TextField } from '../ui/kit.tsx'
import { inboxKey, primeItems } from './itemsData.ts'

export const DRAG_TYPE = 'application/x-wb-item'

type Filter = keyof typeof de.inbox.filters
const FILTERS = Object.keys(de.inbox.filters) as Filter[]

function matches(item: Item, filter: Filter) {
  switch (filter) {
    case 'all':
      return true
    case 'link':
      return item.kind === 'link'
    case 'document':
      return item.kind === 'pdf' || item.kind === 'document' || item.kind === 'file'
    case 'video':
      return item.kind === 'video' || Boolean(item.meta.isVideo)
    default:
      return item.kind === filter
  }
}

/** Consecutive items of one share (same groupId) are shown as a stack (PLAN.md 4.4). */
function groupItems(items: Item[]): Item[][] {
  const groups: Item[][] = []
  for (const item of items) {
    const last = groups.at(-1)
    if (item.groupId && last?.[0]?.groupId === item.groupId) last.push(item)
    else groups.push([item])
  }
  return groups
}

type Actions = {
  onPlaceHere: (ids: string[]) => void
  onDetails: (id: string) => void
}

function Thumb({ item }: { item: Item }) {
  const preview = previewAsset(item)
  return preview ? (
    <img src={assetUrl(preview.id)} alt="" draggable={false} className="h-12 w-12 shrink-0 rounded-md object-cover" />
  ) : (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[var(--wb-hover)] text-2xl">
      {itemIcon(item)}
    </span>
  )
}

function Row({
  item,
  status,
  actions,
  nested = false,
}: {
  item: Item
  status: ItemStatus
  actions: Actions
  nested?: boolean
}) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['items'] })
  const archive = useMutation({ mutationFn: () => api.updateItem(item.id, { status: 'archived' }), onSuccess: refresh })
  const trash = useMutation({ mutationFn: () => api.trashItem(item.id), onSuccess: refresh })
  const restore = useMutation({ mutationFn: () => api.restoreItem(item.id), onSuccess: refresh })
  const canPlace = status === 'inbox' || status === 'archived'

  return (
    <li
      draggable={canPlace}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, item.id)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      title={canPlace ? de.inbox.dragHint : undefined}
      data-item-id={item.id}
      className={`group rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] p-2 text-sm ${canPlace ? 'cursor-grab' : ''} ${nested ? 'ml-3' : ''}`}
    >
      <div className="flex gap-2">
        <Thumb item={item} />
        <button type="button" onClick={() => actions.onDetails(item.id)} className="min-w-0 flex-1 text-left">
          <div className="line-clamp-2 font-medium break-words">{itemTitle(item)}</div>
          <div className="truncate text-xs text-[var(--wb-muted)]">{itemSubline(item)}</div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {item.processing === 'pending' && (
              <span className="flex items-center gap-1 text-[var(--wb-muted)]">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                {de.inbox.processing}
              </span>
            )}
            {item.processing === 'failed' && <span className="text-[var(--wb-danger)]">{de.inbox.failed}</span>}
            {item.targetBoardName && status === 'inbox' && (
              <span className="rounded bg-[var(--wb-hover)] px-1">{de.inbox.target(item.targetBoardName)}</span>
            )}
          </div>
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {canPlace && (
          <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => actions.onPlaceHere([item.id])}>
            {status === 'archived' ? de.inbox.placeAgain : de.inbox.placeHere}
          </Button>
        )}
        {status === 'inbox' && (
          <Button
            variant="ghost"
            className="px-2 py-0.5 text-xs"
            onClick={() => archive.mutate()}
            disabled={archive.isPending}
          >
            {de.inbox.done}
          </Button>
        )}
        {status !== 'trashed' ? (
          <Button
            variant="ghost"
            className="px-2 py-0.5 text-xs text-[var(--wb-danger)]"
            onClick={() => trash.mutate()}
            disabled={trash.isPending}
          >
            {de.inbox.delete}
          </Button>
        ) : (
          <Button
            variant="ghost"
            className="px-2 py-0.5 text-xs"
            onClick={() => restore.mutate()}
            disabled={restore.isPending}
          >
            {de.inbox.restore}
          </Button>
        )}
      </div>
    </li>
  )
}

function Group({ items, status, actions }: { items: Item[]; status: ItemStatus; actions: Actions }) {
  const [open, setOpen] = useState(false)
  const ids = items.map((item) => item.id)
  const canPlace = status === 'inbox' || status === 'archived'
  return (
    <li className="flex flex-col gap-1.5">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag source; without a mouse "Alle hier platzieren" does the same */}
      <div
        draggable={canPlace}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, ids.join(','))
          event.dataTransfer.effectAllowed = 'copy'
        }}
        className={`flex items-center gap-2 rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] p-2 text-sm shadow-[3px_3px_0_var(--wb-border)] ${canPlace ? 'cursor-grab' : ''}`}
      >
        <div className="flex -space-x-6">
          {items.slice(0, 3).map((item) => (
            <Thumb key={item.id} item={item} />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="min-w-0 flex-1 text-left"
          aria-expanded={open}
        >
          <div className="font-medium">
            {open ? '▾' : '▸'} {de.inbox.group(items.length)}
          </div>
          <div className="truncate text-xs text-[var(--wb-muted)]">{itemSubline(items[0] as Item)}</div>
        </button>
        {canPlace && (
          <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => actions.onPlaceHere(ids)}>
            {de.inbox.placeGroup}
          </Button>
        )}
      </div>
      {open && (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <Row key={item.id} item={item} status={status} actions={actions} nested />
          ))}
        </ul>
      )}
    </li>
  )
}

export function AddItemDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'link' | 'text' | 'file'>('link')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)
  const add = useMutation({
    mutationFn: () => {
      if (tab === 'file') {
        const form = new FormData()
        if (text) form.set('text', text)
        for (const file of files ?? []) form.append('files', file, file.name)
        return api.addItem(form)
      }
      return api.addItem(tab === 'link' ? { url, ...(title ? { title } : {}), ...(text ? { text } : {}) } : { text })
    },
    onSuccess: () => {
      setUrl('')
      setTitle('')
      setText('')
      setFiles(null)
      void queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    add.mutate()
  }
  const result = add.data
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        add.reset()
        onOpenChange(next)
      }}
      title={de.addItem.title}
    >
      <div className="mb-3 flex gap-1" role="tablist">
        {(['link', 'text', 'file'] as const).map((key) => (
          <Button
            key={key}
            role="tab"
            aria-selected={tab === key}
            variant={tab === key ? 'primary' : 'secondary'}
            onClick={() => {
              setTab(key)
              add.reset()
            }}
          >
            {de.addItem.tabs[key]}
          </Button>
        ))}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {tab === 'link' && (
          <>
            <TextField
              label={de.addItem.url}
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <TextField label={de.addItem.titleField} value={title} onChange={(e) => setTitle(e.target.value)} />
          </>
        )}
        {tab === 'file' && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="wb-add-files">
              {de.addItem.files}
            </label>
            <input id="wb-add-files" type="file" multiple required onChange={(e) => setFiles(e.target.files)} />
            <p className="text-xs text-[var(--wb-muted)]">{de.addItem.filesHint}</p>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="wb-add-text">
            {tab === 'text' ? de.addItem.text : de.addItem.note}
          </label>
          <textarea
            id="wb-add-text"
            rows={tab === 'text' ? 5 : 2}
            required={tab === 'text'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] px-3 py-2 text-[var(--wb-text)]"
          />
        </div>
        <FormMessage
          error={add.error}
          success={
            result
              ? result.duplicateIds.length > 0 && result.items.length === result.duplicateIds.length
                ? de.addItem.duplicate
                : de.addItem.added(result.items.length)
              : null
          }
        />
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={add.isPending}>
            {de.addItem.submit}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Inbox sidebar content (PLAN.md 4.4). */
export function InboxPanel({
  onPlaceHere,
  onPlaceAllInFrame,
  onDetails,
}: Actions & { onPlaceAllInFrame: (ids: string[]) => void }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ItemStatus>('inbox')
  const [filter, setFilter] = useState<Filter>('all')
  const [adding, setAdding] = useState(false)
  const list = useQuery({
    queryKey: inboxKey(status),
    queryFn: async () => {
      const result = await api.items(status)
      primeItems(queryClient, result.items)
      return result
    },
  })
  const visible = useMemo(() => (list.data?.items ?? []).filter((item) => matches(item, filter)), [list.data, filter])
  const groups = useMemo(() => groupItems(visible), [visible])
  const actions = { onPlaceHere, onDetails }
  const empty =
    status === 'inbox' ? de.inbox.empty : status === 'archived' ? de.inbox.emptyArchive : de.inbox.emptyTrash

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3 text-[var(--wb-text)]">
      <div className="flex gap-1" role="tablist">
        {(['inbox', 'archived', 'trashed'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={status === key}
            onClick={() => setStatus(key)}
            className={`rounded-md px-2 py-1 text-sm ${status === key ? 'bg-[var(--wb-accent)] text-white' : 'text-[var(--wb-muted)] hover:bg-[var(--wb-hover)]'}`}
          >
            {de.inbox.tabs[key]}
          </button>
        ))}
        <Button variant="ghost" className="ml-auto px-2 py-1" onClick={() => setAdding(true)}>
          {de.inbox.add}
        </Button>
      </div>
      {status !== 'trashed' && (
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`rounded-full border px-2 py-0.5 text-xs ${filter === key ? 'border-[var(--wb-accent)] bg-[var(--wb-accent)] text-white' : 'border-[var(--wb-border)] text-[var(--wb-muted)]'}`}
            >
              {de.inbox.filters[key]}
            </button>
          ))}
        </div>
      )}
      {status === 'inbox' && visible.length > 0 && (
        <Button onClick={() => onPlaceAllInFrame(visible.map((item) => item.id))}>📥 {de.inbox.placeAllInFrame}</Button>
      )}
      <FormMessage error={list.error} />
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-4">
        {list.data && visible.length === 0 && (
          <li className="p-2 text-sm text-[var(--wb-muted)]">{filter === 'all' ? empty : de.inbox.emptyFilter}</li>
        )}
        {groups.map((group) =>
          group.length > 1 ? (
            <Group key={group[0]?.id} items={group} status={status} actions={actions} />
          ) : (
            <Row key={group[0]?.id} item={group[0] as Item} status={status} actions={actions} />
          ),
        )}
      </ul>
      <AddItemDialog open={adding} onOpenChange={setAdding} />
    </div>
  )
}

/** Number of items waiting in the inbox (badge on the toggle). */
export function useInboxCount() {
  const queryClient = useQueryClient()
  const list = useQuery({
    queryKey: inboxKey('inbox'),
    queryFn: async () => {
      const result = await api.items('inbox')
      primeItems(queryClient, result.items)
      return result
    },
  })
  return list.data?.items.length ?? 0
}
