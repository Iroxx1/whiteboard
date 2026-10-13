// REST API shapes shared by server and web (PLAN.md 6).
import type { BoardAppState, SceneElement } from './scene.ts'

export type Role = 'admin' | 'member'
export type ThemePreference = 'system' | 'light' | 'dark'

export const PASSWORD_MIN_LENGTH = 10

export type Me = {
  id: string
  email: string
  name: string
  role: Role
  theme: ThemePreference
}

export type AuthStatus = { setupRequired: boolean }

export type SessionInfo = {
  id: string
  createdAt: number
  lastSeenAt: number
  userAgent: string | null
  ip: string | null
  current: boolean
}

export type AdminUser = {
  id: string
  email: string
  name: string
  role: Role
  createdAt: number
  disabledAt: number | null
}

/** A one-time link (invite or password reset), shown to the admin once. */
export type OneTimeLink = { url: string; expiresAt: number }

export type InviteInfo = { role: Role; expiresAt: number }

export type BoardSummary = {
  id: string
  name: string
  hashtag: string
  createdAt: number
  updatedAt: number
  updatedByName: string | null
  deletedAt: number | null
}

export type BoardDetail = BoardSummary & {
  version: number
  elements: SceneElement[]
  appState: BoardAppState
  fileIds: string[]
}

export type SnapshotReason = 'auto' | 'manual' | 'before_restore'

export type SnapshotInfo = {
  id: string
  createdAt: number
  createdByName: string | null
  reason: SnapshotReason
  elementCount: number
}

/** Error codes the API returns as `{ error }`; the web app maps them to German texts. */
export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'too_many_requests'
  | 'invalid_credentials'
  | 'invalid_token'
  | 'email_taken'
  | 'hashtag_taken'
  | 'weak_password'
  | 'wrong_password'
  | 'last_admin'
  | 'file_too_large'
  | 'unsupported_type'
  | 'telegram_unavailable'
  | 'sender_taken'

/** Telegram link state for the settings page (PLAN.md 5.7). */
export type TelegramStatus = {
  /** Bot configured and connected to Telegram. */
  enabled: boolean
  botUsername: string | null
  linked: { username: string | null; linkedAt: number } | null
}

export type TelegramLinkCode = { url: string; expiresAt: number }

/** Own sender addresses for the e-mail inbox (PLAN.md 5.8). */
export type SenderAddress = { email: string; createdAt: number }

/** Inbox address and whether the e-mail channel is configured. */
export type EmailSettings = { enabled: boolean; address: string | null; senders: SenderAddress[] }

/** Admin page "System" (PLAN.md 7.7). */
export type SystemInfo = {
  version: string
  users: number
  boards: number
  items: number
  dbBytes: number
  filesBytes: number
  storage: { freeBytes: number; totalBytes: number; freeShare: number; warning: boolean }
  lastBackup: { file: string; at: number; bytes: number } | null
  jobs: {
    queued: number
    running: number
    failed: number
    failures: { id: string; type: string; lastError: string | null; finishedAt: number | null }[]
  }
  telegram: { configured: boolean; connected: boolean; polling: boolean; username: string | null }
  email: { configured: boolean; address: string | null; accepted7d: number; rejected7d: number; failed7d: number }
}
