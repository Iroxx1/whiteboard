import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ItemDetail } from '@wb/shared'
import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { de } from '../i18n/de.ts'
import { api, assetUrl } from '../lib/api.ts'
import { formatDateTime } from '../lib/format.ts'
import { fileFacts, itemIcon, itemTitle } from '../ui/itemDisplay.ts'
import { Button, FormMessage } from '../ui/kit.tsx'
import { itemDetailKey, itemKey } from './itemsData.ts'

function Preview({ item }: { item: ItemDetail }) {
  const original = item.assets.original
  if (item.meta.embed) {
    return (
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
        <iframe
          src={item.meta.embed.embedUrl}
          title={itemTitle(item)}
          className="h-full w-full"
          allow="encrypted-media; picture-in-picture; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    )
  }
  if (item.kind === 'audio' && original) {
    return (
      // biome-ignore lint/a11y/useMediaCaption: user-shared voice messages have no captions (transcripts follow in Phase 9)
      <audio controls preload="metadata" src={assetUrl(original.id)} className="w-full">
        {de.details.noPlayer}
      </audio>
    )
  }
  if (item.kind === 'video' && original) {
    return (
      // biome-ignore lint/a11y/useMediaCaption: user-shared videos have no captions
      <video
        controls
        preload="metadata"
        src={assetUrl(original.id)}
        poster={item.assets.poster ? assetUrl(item.assets.poster.id) : undefined}
        className="max-h-[50vh] w-full rounded-lg bg-black"
      >
        {de.details.noPlayer}
      </video>
    )
  }
  const picture = item.assets.display ?? item.assets.og_image ?? item.assets.page1
  if (picture)
    return <img src={assetUrl(picture.id)} alt="" className="max-h-[50vh] w-full rounded-lg object-contain" />
  return <div className="text-5xl">{itemIcon(item)}</div>
}

function EditableField({
  label,
  value,
  multiline,
  onSave,
}: {
  label: string
  value: string | null
  multiline?: boolean
  onSave: (value: string) => Promise<unknown>
}) {
  const id = useId()
  const [draft, setDraft] = useState(value ?? '')
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle')
  useEffect(() => setDraft(value ?? ''), [value])
  const save = () => {
    if (draft === (value ?? '')) return
    onSave(draft).then(
      () => setState('saved'),
      () => setState('error'),
    )
  }
  const className =
    'w-full rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] px-2 py-1.5 text-[var(--wb-text)] focus:border-[var(--wb-accent)] outline-none'
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="flex justify-between font-medium">
        {label}
        {state === 'saved' && <span className="text-xs font-normal text-[var(--wb-success)]">{de.details.saved}</span>}
        {state === 'error' && <span className="text-xs font-normal text-[var(--wb-danger)]">{de.errors.unknown}</span>}
      </label>
      {multiline ? (
        <textarea
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          className={className}
        />
      ) : (
        <input id={id} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} className={className} />
      )}
    </div>
  )
}

/** Detail view of an item (PLAN.md 5.4 "Detailansicht"). */
export function ItemDetails({ itemId, onClose }: { itemId: string; onClose?: () => void }) {
  const queryClient = useQueryClient()
  const detail = useQuery({ queryKey: itemDetailKey(itemId), queryFn: () => api.item(itemId) })
  const boards = useQuery({ queryKey: ['boards'], queryFn: () => api.boards() })
  const [copied, setCopied] = useState<string | null>(null)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: itemDetailKey(itemId) })
    void queryClient.invalidateQueries({ queryKey: itemKey(itemId) })
    void queryClient.invalidateQueries({ queryKey: ['items'] })
  }
  const update = useMutation({
    mutationFn: (body: Parameters<typeof api.updateItem>[1]) => api.updateItem(itemId, body),
    onSuccess: refresh,
  })
  const trash = useMutation({ mutationFn: () => api.trashItem(itemId), onSuccess: refresh })
  const restore = useMutation({ mutationFn: () => api.restoreItem(itemId), onSuccess: refresh })

  if (detail.isPending) return <p className="p-4 text-[var(--wb-muted)]">{de.common.loading}</p>
  if (detail.error) return <FormMessage error={detail.error} />
  const item = detail.data
  const original = item.assets.original

  return (
    <div className="flex flex-col gap-4 p-4 text-[var(--wb-text)]">
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-lg font-semibold break-words">{itemTitle(item)}</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={de.common.close}
            className="text-xl text-[var(--wb-muted)]"
          >
            ✕
          </button>
        )}
      </div>
      <Preview item={item} />
      <div className="text-xs text-[var(--wb-muted)]">
        {[item.createdByName, de.sources[item.source], formatDateTime(item.createdAt)].filter(Boolean).join(' · ')}
        {item.kind !== 'link' && item.kind !== 'note' && <div>{fileFacts(item)}</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-[var(--wb-accent)] px-3 py-1.5 text-sm text-white"
          >
            ↗ {de.details.openLink}
          </a>
        )}
        {original && (
          <>
            <a
              href={assetUrl(original.id)}
              target="_blank"
              rel="noopener"
              className="rounded-lg border border-[var(--wb-border)] px-3 py-1.5 text-sm"
            >
              {de.details.openOriginal}
            </a>
            <a
              href={assetUrl(original.id, true)}
              className="rounded-lg border border-[var(--wb-border)] px-3 py-1.5 text-sm"
            >
              ⬇ {de.details.download}
            </a>
          </>
        )}
      </div>
      {item.status !== 'trashed' && (
        <>
          <EditableField
            label={de.details.titleField}
            value={item.title}
            onSave={(title) => update.mutateAsync({ title })}
          />
          <EditableField
            label={de.details.noteField}
            value={item.note}
            multiline
            onSave={(note) => update.mutateAsync({ note })}
          />
        </>
      )}
      {item.texts.map((text) => (
        <section key={text.kind} className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-sm font-medium">
            {de.details.texts[text.kind]}
            <Button
              variant="ghost"
              className="px-2 py-0.5 text-xs"
              onClick={() => void navigator.clipboard?.writeText(text.text).then(() => setCopied(text.kind))}
            >
              {copied === text.kind ? de.common.copied : de.details.copy}
            </Button>
          </div>
          <pre className="max-h-60 overflow-auto rounded-lg bg-[var(--wb-hover)] p-2 text-xs whitespace-pre-wrap">
            {text.text}
          </pre>
        </section>
      ))}
      <section className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{de.details.boards}</span>
        {item.placements.length === 0 ? (
          <span className="text-[var(--wb-muted)]">{de.details.noBoards}</span>
        ) : (
          <ul>
            {item.placements.map((placement) => (
              <li key={placement.boardId}>
                <Link to={`/b/${placement.boardId}`} className="text-[var(--wb-accent)] underline">
                  {placement.boardName}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {item.status !== 'trashed' ? (
        <div className="flex flex-col gap-2 border-t border-[var(--wb-border)] pt-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{de.details.putOnBoard}</span>
            <select
              value={item.targetBoardId ?? ''}
              onChange={(event) => update.mutate({ targetBoardId: event.target.value || null })}
              className="rounded-lg border border-[var(--wb-border)] bg-[var(--wb-surface)] px-2 py-1.5"
            >
              <option value="">{de.details.onlyInbox}</option>
              {boards.data?.map((board) => (
                <option key={board.id} value={board.id}>
                  {board.name} (#{board.hashtag})
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            {item.status === 'inbox' && (
              <Button onClick={() => update.mutate({ status: 'archived' })} disabled={update.isPending}>
                {de.details.archive}
              </Button>
            )}
            <Button variant="danger" onClick={() => trash.mutate()} disabled={trash.isPending}>
              {de.details.delete}
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => restore.mutate()} disabled={restore.isPending}>
          {de.details.restore}
        </Button>
      )}
      <FormMessage error={update.error ?? trash.error ?? restore.error} />
    </div>
  )
}
