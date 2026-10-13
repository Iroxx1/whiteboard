import type {
  AdminUser,
  ApiErrorCode,
  AuthStatus,
  BoardDetail,
  BoardSummary,
  EmailSettings,
  IngestResult,
  InviteInfo,
  Item,
  ItemDetail,
  ItemList,
  ItemStatus,
  Me,
  OneTimeLink,
  Role,
  SenderAddress,
  SessionInfo,
  SnapshotInfo,
  SystemInfo,
  TelegramLinkCode,
  TelegramStatus,
  ThemePreference,
} from '@wb/shared'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'network' | 'unknown',
    readonly details: { reason?: string; retryAfterSeconds?: number } = {},
  ) {
    super(`HTTP ${status} ${code}`)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'network')
  }
  if (response.status === 204) return undefined as T
  const data = (await response.json().catch(() => ({}))) as { error?: ApiErrorCode } & Record<string, unknown>
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'unknown', data as ApiError['details'])
  return data as T
}

const get = <T>(path: string) => request<T>('GET', path)
const enc = encodeURIComponent

export const api = {
  status: () => get<AuthStatus>('/api/auth/status'),
  me: () => get<Me>('/api/auth/me'),
  setup: (body: { token: string; name: string; email: string; password: string }) =>
    request<Me>('POST', '/api/auth/setup', body),
  login: (body: { email: string; password: string }) => request<Me>('POST', '/api/auth/login', body),
  logout: () => request<void>('POST', '/api/auth/logout'),
  invite: (token: string) => get<InviteInfo>(`/api/invites/${enc(token)}`),
  acceptInvite: (token: string, body: { name: string; email: string; password: string }) =>
    request<Me>('POST', `/api/invites/${enc(token)}`, body),
  resetPassword: (token: string, password: string) =>
    request<Me>('POST', `/api/auth/reset/${enc(token)}`, { password }),

  updateMe: (body: { name?: string; theme?: ThemePreference }) => request<Me>('PUT', '/api/me', body),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<void>('PUT', '/api/me/password', body),
  sessions: () => get<SessionInfo[]>('/api/me/sessions'),
  revokeSession: (id: string) => request<void>('DELETE', `/api/me/sessions/${enc(id)}`),
  telegram: () => get<TelegramStatus>('/api/me/telegram'),
  telegramLinkCode: () => request<TelegramLinkCode>('POST', '/api/me/telegram/link-code'),
  telegramUnlink: () => request<void>('DELETE', '/api/me/telegram'),
  emailSettings: () => get<EmailSettings>('/api/me/email'),
  addSender: (email: string) => request<SenderAddress[]>('POST', '/api/me/senders', { email }),
  removeSender: (email: string) => request<void>('DELETE', `/api/me/senders/${enc(email)}`),

  users: () => get<AdminUser[]>('/api/admin/users'),
  createInvite: (role: Role) => request<OneTimeLink>('POST', '/api/admin/invites', { role }),
  updateUser: (id: string, body: { disabled?: boolean; role?: Role }) =>
    request<AdminUser>('PATCH', `/api/admin/users/${enc(id)}`, body),
  resetLink: (id: string) => request<OneTimeLink>('POST', `/api/admin/users/${enc(id)}/reset-link`),
  system: () => get<SystemInfo>('/api/admin/system'),
  retryJobs: (id?: string) => request<{ retried: number }>('POST', '/api/admin/jobs/retry', id ? { id } : {}),
  backupNow: () => request<{ file: string | null }>('POST', '/api/admin/backup'),

  boards: (trash = false) => get<BoardSummary[]>(`/api/boards${trash ? '?trash=1' : ''}`),
  board: (id: string) => get<BoardDetail>(`/api/boards/${enc(id)}`),
  createBoard: (body: { name: string; hashtag?: string }) => request<BoardSummary>('POST', '/api/boards', body),
  updateBoard: (id: string, body: { name?: string; hashtag?: string }) =>
    request<BoardSummary>('PATCH', `/api/boards/${enc(id)}`, body),
  deleteBoard: (id: string) => request<void>('DELETE', `/api/boards/${enc(id)}`),
  restoreBoard: (id: string) => request<BoardSummary>('POST', `/api/boards/${enc(id)}/restore`),
  snapshots: (id: string) => get<SnapshotInfo[]>(`/api/boards/${enc(id)}/snapshots`),
  createSnapshot: (id: string) => request<SnapshotInfo>('POST', `/api/boards/${enc(id)}/snapshots`),
  restoreSnapshot: (id: string, snapshotId: string) =>
    request<void>('POST', `/api/boards/${enc(id)}/snapshots/${enc(snapshotId)}/restore`),
  uploadBoardFile: (boardId: string, fileId: string, blob: Blob) => {
    const form = new FormData()
    form.set('fileId', fileId)
    form.set('file', blob, fileId)
    return request<{ fileId: string }>('POST', `/api/boards/${enc(boardId)}/files`, form)
  },

  items: (status: ItemStatus, cursor?: string) =>
    get<ItemList>(`/api/items?status=${status}&limit=200${cursor ? `&cursor=${enc(cursor)}` : ''}`),
  itemsByIds: (ids: string[]) => get<ItemList>(`/api/items?ids=${ids.map(enc).join(',')}`),
  item: (id: string) => get<ItemDetail>(`/api/items/${enc(id)}`),
  addItem: (body: { text?: string; url?: string; title?: string } | FormData) =>
    request<IngestResult>('POST', '/api/items', body),
  updateItem: (
    id: string,
    body: { title?: string | null; note?: string | null; targetBoardId?: string | null; status?: 'inbox' | 'archived' },
  ) => request<Item>('PATCH', `/api/items/${enc(id)}`, body),
  trashItem: (id: string) => request<void>('DELETE', `/api/items/${enc(id)}`),
  restoreItem: (id: string) => request<void>('POST', `/api/items/${enc(id)}/restore`),
  unplaceItem: (id: string, boardId: string) => request<void>('POST', `/api/items/${enc(id)}/unplace`, { boardId }),
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} KB`
  return `${(size / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`
}

export const assetUrl = (id: string, download = false) =>
  `/api/assets/${encodeURIComponent(id)}${download ? '?download=1' : ''}`
