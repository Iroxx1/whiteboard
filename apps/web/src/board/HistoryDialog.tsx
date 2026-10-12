import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { de } from '../i18n/de.ts'
import { api } from '../lib/api.ts'
import { formatDateTime } from '../lib/format.ts'
import { Button, Dialog, FormMessage } from '../ui/kit.tsx'

/** Board history (PLAN.md 4.6): snapshots with "restore" and "save version now". */
export function HistoryDialog({
  boardId,
  open,
  onOpenChange,
}: {
  boardId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const key = ['snapshots', boardId]
  const snapshots = useQuery({ queryKey: key, queryFn: () => api.snapshots(boardId), enabled: open })
  const [confirming, setConfirming] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })
  const save = useMutation({
    mutationFn: () => api.createSnapshot(boardId),
    onSuccess: () => {
      setMessage(de.history.savedNow)
      void refresh()
    },
  })
  const restore = useMutation({
    mutationFn: (snapshotId: string) => api.restoreSnapshot(boardId, snapshotId),
    onSuccess: () => {
      setConfirming(null)
      setMessage(de.history.restored)
      void refresh()
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setConfirming(null)
        setMessage(null)
        onOpenChange(next)
      }}
      title={de.history.title}
      description={de.history.intro}
      wide
    >
      <div className="mb-3 flex items-center gap-3">
        <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
          {de.history.saveNow}
        </Button>
        <FormMessage error={save.error ?? restore.error ?? snapshots.error} success={message} />
      </div>
      {snapshots.data?.length === 0 && <p className="text-sm text-[var(--wb-muted)]">{de.history.empty}</p>}
      <ul className="divide-y divide-[var(--wb-border)]">
        {snapshots.data?.map((snapshot) => (
          <li key={snapshot.id} className="py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 text-sm">
                <div className="font-medium">{formatDateTime(snapshot.createdAt)}</div>
                <div className="text-xs text-[var(--wb-muted)]">
                  {de.history.reasons[snapshot.reason]}
                  {snapshot.createdByName ? ` · ${snapshot.createdByName}` : ''} ·{' '}
                  {de.history.elements(snapshot.elementCount)}
                </div>
              </div>
              <Button onClick={() => setConfirming(snapshot.id)} disabled={restore.isPending}>
                {de.history.restore}
              </Button>
            </div>
            {confirming === snapshot.id && (
              <div className="mt-2 rounded-lg bg-[var(--wb-hover)] p-2 text-sm">
                <p className="mb-2">{de.history.confirmRestore}</p>
                <div className="flex gap-2">
                  <Button variant="danger" onClick={() => restore.mutate(snapshot.id)} disabled={restore.isPending}>
                    {de.history.restore}
                  </Button>
                  <Button onClick={() => setConfirming(null)}>{de.common.cancel}</Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
