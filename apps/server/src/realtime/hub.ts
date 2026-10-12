import type { Server } from 'socket.io'

export const boardRoom = (boardId: string) => `board:${boardId}`
export const sessionRoom = (sessionId: string) => `session:${sessionId}`
export const userRoom = (userId: string) => `user:${userId}`

/**
 * Lets HTTP routes and the board state talk to connected clients without depending on socket.io
 * directly. Until a socket.io server is attached (e.g. in tests without one) all calls are no-ops.
 */
export class RealtimeHub {
  private io: Server | undefined

  attach(io: Server) {
    this.io = io
  }

  /** Sends to everyone in the board's room, optionally except the socket that caused the change. */
  toBoard(boardId: string, event: string, payload: unknown, exceptSocketId?: string) {
    if (!this.io) return
    const target = exceptSocketId
      ? this.io.to(boardRoom(boardId)).except(exceptSocketId)
      : this.io.to(boardRoom(boardId))
    target.emit(event, payload)
  }

  toAll(event: string, payload: unknown) {
    this.io?.emit(event, payload)
  }

  /** Ends the live connections of a revoked session (logout, "sign out device"). */
  disconnectSession(sessionId: string) {
    this.io?.in(sessionRoom(sessionId)).disconnectSockets(true)
  }

  /** Ends all live connections of a user (disabled, password reset). */
  disconnectUser(userId: string) {
    this.io?.in(userRoom(userId)).disconnectSockets(true)
  }
}
