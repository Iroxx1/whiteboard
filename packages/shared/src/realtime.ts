// socket.io events (PLAN.md 6).
import type { BoardAppState, SceneElement } from './scene.ts'

export const EVENTS = {
  boardJoin: 'board:join',
  boardLeave: 'board:leave',
  boardUpdate: 'board:update',
  presenceUpdate: 'presence:update',
  presenceLeave: 'presence:leave',
  boardsChanged: 'boards:changed',
} as const

/** Limit for one board:update message (PLAN.md 8.5). */
export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024

export type AckError = { ok: false; error: 'not_found' | 'invalid' | 'not_joined' | 'server_error' }

export type JoinRequest = { boardId: string }
export type JoinAck =
  | { ok: true; version: number; elements: SceneElement[]; appState: BoardAppState; pendingItemIds: string[] }
  | AckError

export type BoardUpdate = { boardId: string; elements: SceneElement[]; appState?: BoardAppState }
export type UpdateAck = { ok: true } | AckError

export type PresencePointer = { x: number; y: number; tool: 'pointer' | 'laser' }

export type PresenceUpdate = {
  boardId: string
  pointer: PresencePointer | null
  button: 'up' | 'down'
  selectedElementIds: Record<string, true>
}

/** What other clients receive: the server adds who it is. */
export type PresenceBroadcast = PresenceUpdate & {
  socketId: string
  userId: string
  name: string
  color: { background: string; stroke: string }
}

export type PresenceLeave = { boardId: string; socketId: string }
