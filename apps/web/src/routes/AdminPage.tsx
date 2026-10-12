import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminUser, OneTimeLink, Role } from '@wb/shared'
import { useState } from 'react'
import { de } from '../i18n/de.ts'
import { api, formatBytes } from '../lib/api.ts'
import { useMe } from '../lib/auth.tsx'
import { formatDate, formatDateTime } from '../lib/format.ts'
import { Button, Card, CopyLink, Dialog, FormMessage } from '../ui/kit.tsx'
import { Layout } from '../ui/Layout.tsx'

type ShownLink = { title: string; text: string; link: OneTimeLink }

function UserRow({ user, self, onLink }: { user: AdminUser; self: boolean; onLink: (link: ShownLink) => void }) {
  const queryClient = useQueryClient()
  const update = useMutation({
    mutationFn: (body: { disabled?: boolean; role?: Role }) => api.updateUser(user.id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })
  const reset = useMutation({
    mutationFn: () => api.resetLink(user.id),
    onSuccess: (link) => onLink({ title: de.admin.resetTitle, text: de.admin.resetText(user.name), link }),
  })
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="min-w-0">
        <div className="font-medium">
          {user.name}
          {self && <span className="ml-1 text-xs text-[var(--wb-muted)]">({de.admin.you})</span>}
          <span className="ml-2 rounded bg-[var(--wb-hover)] px-1.5 py-0.5 text-xs">
            {user.role === 'admin' ? de.admin.roleAdmin : de.admin.roleMember}
          </span>
          {user.disabledAt && (
            <span className="ml-1 rounded bg-[var(--wb-danger)] px-1.5 py-0.5 text-xs text-white">
              {de.admin.disabled}
            </span>
          )}
        </div>
        <div className="text-xs text-[var(--wb-muted)]">
          {user.email} · {de.admin.since(formatDate(user.createdAt))}
        </div>
        <FormMessage error={update.error ?? reset.error} />
      </div>
      {!self && (
        <div className="flex flex-wrap gap-1.5">
          <Button onClick={() => reset.mutate()} disabled={reset.isPending || Boolean(user.disabledAt)}>
            {de.admin.resetLink}
          </Button>
          <Button
            onClick={() => update.mutate({ role: user.role === 'admin' ? 'member' : 'admin' })}
            disabled={update.isPending}
          >
            {user.role === 'admin' ? de.admin.makeMember : de.admin.makeAdmin}
          </Button>
          <Button
            variant={user.disabledAt ? 'secondary' : 'danger'}
            onClick={() => update.mutate({ disabled: !user.disabledAt })}
            disabled={update.isPending}
          >
            {user.disabledAt ? de.admin.enable : de.admin.disable}
          </Button>
        </div>
      )}
    </li>
  )
}

export function AdminPage() {
  const me = useMe()
  const users = useQuery({ queryKey: ['admin-users'], queryFn: api.users })
  const system = useQuery({ queryKey: ['admin-system'], queryFn: api.system })
  const [inviteAdmin, setInviteAdmin] = useState(false)
  const [shown, setShown] = useState<ShownLink | null>(null)
  const invite = useMutation({
    mutationFn: () => api.createInvite(inviteAdmin ? 'admin' : 'member'),
    onSuccess: (link) => setShown({ title: de.admin.inviteTitle, text: de.admin.inviteText, link }),
  })

  return (
    <Layout>
      <h1 className="mb-4 text-2xl font-semibold">{de.admin.title}</h1>
      <div className="flex flex-col gap-4">
        <Card
          title={de.admin.users}
          actions={
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={inviteAdmin} onChange={(e) => setInviteAdmin(e.target.checked)} />
                {de.admin.inviteAdmin}
              </label>
              <Button variant="primary" onClick={() => invite.mutate()} disabled={invite.isPending}>
                + {de.admin.invite}
              </Button>
            </div>
          }
        >
          <FormMessage error={users.error ?? invite.error} />
          <ul className="divide-y divide-[var(--wb-border)]">
            {users.data?.map((user) => (
              <UserRow key={user.id} user={user} self={user.id === me.data?.id} onLink={setShown} />
            ))}
          </ul>
        </Card>
        {system.data && (
          <Card title={de.admin.system}>
            <dl className="grid grid-cols-[8rem_1fr] gap-1 text-sm">
              <dt className="text-[var(--wb-muted)]">{de.admin.version}</dt>
              <dd className="font-mono">{system.data.version}</dd>
              <dt className="text-[var(--wb-muted)]">{de.admin.dbSize}</dt>
              <dd>{formatBytes(system.data.dbBytes)}</dd>
              <dt className="text-[var(--wb-muted)]">{de.nav.boards}</dt>
              <dd>{de.admin.counts(system.data.users, system.data.boards)}</dd>
            </dl>
          </Card>
        )}
      </div>

      <Dialog open={shown !== null} onOpenChange={(open) => !open && setShown(null)} title={shown?.title ?? ''}>
        {shown && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">{shown.text}</p>
            <CopyLink url={shown.link.url} />
            <p className="text-xs text-[var(--wb-muted)]">
              {de.common.validUntil} {formatDateTime(shown.link.expiresAt)}. {de.admin.linkOnce}
            </p>
            <div className="flex justify-end">
              <Button onClick={() => setShown(null)}>{de.common.close}</Button>
            </div>
          </div>
        )}
      </Dialog>
    </Layout>
  )
}
