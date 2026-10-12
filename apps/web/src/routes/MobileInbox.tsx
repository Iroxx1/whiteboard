import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Item } from '@wb/shared'
import { useState } from 'react'
import { Link } from 'react-router'
import { AddItemDialog } from '../board/InboxPanel.tsx'
import { inboxKey, primeItems } from '../board/itemsData.ts'
import { de } from '../i18n/de.ts'
import { api, assetUrl } from '../lib/api.ts'
import { usePwa } from '../lib/pwa.ts'
import { BoardPicker } from '../ui/BoardPicker.tsx'
import { itemIcon, itemSubline, itemTitle, previewAsset } from '../ui/itemDisplay.ts'
import { Button, Dialog, FormMessage } from '../ui/kit.tsx'

function MobileRow({ item, onPickBoard }: { item: Item; onPickBoard: (item: Item) => void }) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['items'] })
  const archive = useMutation({ mutationFn: () => api.updateItem(item.id, { status: 'archived' }), onSuccess: refresh })
  const trash = useMutation({ mutationFn: () => api.trashItem(item.id), onSuccess: refresh })
  const preview = previewAsset(item)
  return (
    <li className="rounded-xl border border-[var(--wb-border)] bg-[var(--wb-surface)] p-3" data-item-id={item.id}>
      <Link to={`/i/${item.id}`} className="flex gap-3">
        {preview ? (
          <img src={assetUrl(preview.id)} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[var(--wb-hover)] text-2xl">
            {itemIcon(item)}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-medium break-words">{itemTitle(item)}</span>
          {item.note && item.kind !== 'note' && (
            <span className="line-clamp-1 text-sm text-[var(--wb-muted)] italic">{item.note}</span>
          )}
          <span className="block truncate text-xs text-[var(--wb-muted)]">{itemSubline(item)}</span>
          {item.processing === 'pending' && (
            <span className="text-xs text-[var(--wb-muted)]">{de.inbox.processing}</span>
          )}
          {item.targetBoardName && <span className="text-xs">{de.inbox.target(item.targetBoardName)}</span>}
        </span>
      </Link>
      <div className="mt-2 flex flex-wrap gap-1">
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onPickBoard(item)}>
          📋 {de.mobile.putOnBoard}
        </Button>
        <Link to={`/i/${item.id}`} className="rounded-lg px-2 py-1 text-xs text-[var(--wb-accent)]">
          ✏️ {de.mobile.editNote}
        </Link>
        <Button
          variant="ghost"
          className="px-2 py-1 text-xs"
          onClick={() => archive.mutate()}
          disabled={archive.isPending}
        >
          {de.inbox.done}
        </Button>
        <Button
          variant="ghost"
          className="px-2 py-1 text-xs text-[var(--wb-danger)]"
          onClick={() => trash.mutate()}
          disabled={trash.isPending}
        >
          {de.inbox.delete}
        </Button>
      </div>
    </li>
  )
}

/** Inbox list for phones (PLAN.md 4.5). */
export function MobileInbox() {
  const queryClient = useQueryClient()
  const { pendingShares } = usePwa()
  const [adding, setAdding] = useState(false)
  const [picking, setPicking] = useState<Item | null>(null)
  const list = useQuery({
    queryKey: inboxKey('inbox'),
    queryFn: async () => {
      const result = await api.items('inbox')
      primeItems(queryClient, result.items)
      return result
    },
    // No live connection outside boards: refresh regularly while visible.
    refetchInterval: 20_000,
  })
  const move = useMutation({
    mutationFn: ({ id, boardId }: { id: string; boardId: string | null }) =>
      api.updateItem(id, { targetBoardId: boardId }),
    onSuccess: () => {
      setPicking(null)
      void queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">{de.inbox.title}</h1>
        <Button variant="primary" onClick={() => setAdding(true)}>
          {de.inbox.add}
        </Button>
      </div>
      {pendingShares > 0 && (
        <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          ⏳ {de.share.waitingCount(pendingShares)}
        </p>
      )}
      <FormMessage error={list.error} />
      {list.data?.items.length === 0 && <p className="text-[var(--wb-muted)]">{de.inbox.empty}</p>}
      <ul className="flex flex-col gap-2">
        {list.data?.items.map((item) => (
          <MobileRow key={item.id} item={item} onPickBoard={setPicking} />
        ))}
      </ul>
      <AddItemDialog open={adding} onOpenChange={setAdding} />
      <Dialog open={picking !== null} onOpenChange={(open) => !open && setPicking(null)} title={de.mobile.chooseBoard}>
        {picking && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">{itemTitle(picking)}</p>
            <BoardPicker
              value={picking.targetBoardId}
              onChange={(boardId) => move.mutate({ id: picking.id, boardId })}
            />
            <FormMessage error={move.error} />
          </div>
        )}
      </Dialog>
    </div>
  )
}
