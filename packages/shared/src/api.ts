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
