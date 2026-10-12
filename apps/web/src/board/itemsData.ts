import { type QueryClient, useQuery } from '@tanstack/react-query'
import type { Item, ItemStatus } from '@wb/shared'
import { api } from '../lib/api.ts'

export const itemKey = (id: string) => ['item', id] as const
export const itemDetailKey = (id: string) => ['item-detail', id] as const
export const inboxKey = (status: ItemStatus) => ['items', status] as const

// Cards ask for their item one by one; requests within a short window are bundled into one
// `GET /api/items?ids=…` (PLAN.md 5.4 "Inhalt").
let pending = new Map<string, { resolve: (item: Item | null) => void; reject: (error: unknown) => void }[]>()
let timer: ReturnType<typeof setTimeout> | undefined

function flush() {
  const batch = pending
  pending = new Map()
  timer = undefined
  const ids = [...batch.keys()]
  for (let start = 0; start < ids.length; start += 150) {
    const chunk = ids.slice(start, start + 150)
    api.itemsByIds(chunk).then(
      ({ items }) => {
        const byId = new Map(items.map((item) => [item.id, item]))
        for (const id of chunk) for (const waiter of batch.get(id) ?? []) waiter.resolve(byId.get(id) ?? null)
      },
      (error: unknown) => {
        for (const id of chunk) for (const waiter of batch.get(id) ?? []) waiter.reject(error)
      },
    )
  }
}

export function loadItem(id: string): Promise<Item | null> {
  return new Promise((resolve, reject) => {
    pending.set(id, [...(pending.get(id) ?? []), { resolve, reject }])
    if (timer === undefined) timer = setTimeout(flush, 15)
  })
}

export function useItem(id: string) {
  return useQuery({ queryKey: itemKey(id), queryFn: () => loadItem(id), staleTime: 60_000 })
}

/** Puts items from a list into the per-item cache, so cards and the inbox share data. */
export function primeItems(queryClient: QueryClient, items: Item[]) {
  for (const item of items) queryClient.setQueryData(itemKey(item.id), item)
}

/** Live events (PLAN.md 5.4): `inbox:changed` reloads lists, `item:updated` one item. */
export function handleInboxChanged(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ['items'] })
}

export function handleItemUpdated(queryClient: QueryClient, itemId: string) {
  void queryClient.invalidateQueries({ queryKey: itemKey(itemId) })
  void queryClient.invalidateQueries({ queryKey: itemDetailKey(itemId) })
}
