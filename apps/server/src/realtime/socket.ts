import {
  type AckError,
  EVENTS,
  type JoinAck,
  MAX_MESSAGE_BYTES,
  type PresenceBroadcast,
  type PresenceLeave,
  type UpdateAck,
} from '@wb/shared'
import type { FastifyInstance } from 'fastify'
import { Server } from 'socket.io'
import { z } from 'zod'
import { SESSION_COOKIE, type SessionUser } from '../auth/sessions.ts'
import { boardUpdateSchema } from '../boards/elements.ts'
import type { AppContext } from '../context.ts'
import { boardRoom, sessionRoom, userRoom } from './hub.ts'

type SocketData = { user: SessionUser; sessionId: string; boards: Set<string> }

const boardIdSchema = z.object({ boardId: z.string().min(1).max(40) })
const presenceSchema = z.object({
  boardId: z.string().min(1).max(40),
  pointer: z.object({ x: z.number(), y: z.number(), tool: z.enum(['pointer', 'laser']) }).nullable(),
  button: z.enum(['up', 'down']),
  selectedElementIds: z.record(z.string().max(100), z.literal(true)),
})

// Cursor colours (Excalidraw collaborator style): background for the pointer, stroke for the outline.
const COLORS = [
  { background: '#4c6ef5', stroke: '#364fc7' },
  { background: '#f76707', stroke: '#d9480f' },
  { background: '#37b24d', stroke: '#2b8a3e' },
  { background: '#e64980', stroke: '#c2255c' },
  { background: '#7950f2', stroke: '#5f3dc4' },
  { background: '#1098ad', stroke: '#0b7285' },
  { background: '#f59f00', stroke: '#e67700' },
  { background: '#fa5252', stroke: '#e03131' },
]

export function colorFor(userId: string) {
  let hash = 0
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return COLORS[hash % COLORS.length] as (typeof COLORS)[number]
}

type Ack<T> = ((response: T) => void) | undefined

const invalid: AckError = { ok: false, error: 'invalid' }

/**
 * socket.io endpoint (PLAN.md 5.3, 6). The handshake requires a valid session cookie and our own
 * Origin (PLAN.md 5.12); every event is validated.
 */
export function attachSocketServer(app: FastifyInstance, ctx: AppContext): Server {
  const publicOrigin = new URL(ctx.config.PUBLIC_URL).origin
  const io = new Server(app.server, {
    path: '/socket.io',
    serveClient: false,
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    cors: { origin: false },
    // Browsers omit Origin on same-origin GETs (long polling); Sec-Fetch-Site covers those.
    allowRequest: (request, callback) => {
      const { origin } = request.headers
      callback(
        null,
        origin === publicOrigin || (origin === undefined && request.headers['sec-fetch-site'] === 'same-origin'),
      )
    },
  })

  io.use((socket, next) => {
    const cookies = app.parseCookie(socket.handshake.headers.cookie ?? '')
    const auth = ctx.sessions.validate(cookies[SESSION_COOKIE])
    if (!auth) return next(new Error('unauthorized'))
    socket.data = { user: auth.user, sessionId: auth.sessionId, boards: new Set() } satisfies SocketData
    next()
  })

  io.on('connection', (socket) => {
    const data = socket.data as SocketData
    const { user, sessionId } = data
    void socket.join([sessionRoom(sessionId), userRoom(user.id)])
    const color = colorFor(user.id)

    const leaveBoard = (boardId: string) => {
      if (!data.boards.delete(boardId)) return
      void socket.leave(boardRoom(boardId))
      ctx.rooms.leave(boardId, socket.id)
      socket.to(boardRoom(boardId)).emit(EVENTS.presenceLeave, { boardId, socketId: socket.id } satisfies PresenceLeave)
    }

    const handle = <T>(name: string, ack: Ack<T>, run: () => T) => {
      try {
        const result = run()
        if (typeof ack === 'function') ack(result)
      } catch (error) {
        ctx.log.error({ err: error, event: name }, 'socket handler failed')
        if (typeof ack === 'function') ack({ ok: false, error: 'server_error' } as T)
      }
    }

    socket.on(EVENTS.boardJoin, (payload: unknown, ack: Ack<JoinAck>) =>
      handle(EVENTS.boardJoin, ack, (): JoinAck => {
        const parsed = boardIdSchema.safeParse(payload)
        if (!parsed.success) return invalid
        const { boardId } = parsed.data
        const state = ctx.rooms.join(boardId, socket.id)
        if (!state) return { ok: false, error: 'not_found' }
        data.boards.add(boardId)
        void socket.join(boardRoom(boardId))
        // pendingItemIds: automatic placement of inbox items arrives in Phase 2.
        return {
          ok: true,
          version: state.version,
          elements: state.elements,
          appState: state.appState,
          pendingItemIds: [],
        }
      }),
    )

    socket.on(EVENTS.boardLeave, (payload: unknown) => {
      const parsed = boardIdSchema.safeParse(payload)
      if (parsed.success) leaveBoard(parsed.data.boardId)
    })

    socket.on(EVENTS.boardUpdate, (payload: unknown, ack: Ack<UpdateAck>) =>
      handle(EVENTS.boardUpdate, ack, (): UpdateAck => {
        const parsed = boardUpdateSchema.safeParse(payload)
        if (!parsed.success) return invalid
        const { boardId, elements, appState } = parsed.data
        if (!data.boards.has(boardId) || !ctx.rooms.isMember(boardId, socket.id)) {
          return { ok: false, error: 'not_joined' }
        }
        const result = ctx.rooms.applyUpdate(boardId, user.id, elements, appState)
        if (!result) return { ok: false, error: 'not_found' }
        if (result.elements.length > 0 || result.appState) {
          socket.to(boardRoom(boardId)).emit(EVENTS.boardUpdate, { boardId, ...result })
        }
        return { ok: true }
      }),
    )

    socket.on(EVENTS.presenceUpdate, (payload: unknown) => {
      const parsed = presenceSchema.safeParse(payload)
      if (!parsed.success || !data.boards.has(parsed.data.boardId)) return
      const message: PresenceBroadcast = {
        ...parsed.data,
        socketId: socket.id,
        userId: user.id,
        name: user.name,
        color,
      }
      socket.volatile.to(boardRoom(parsed.data.boardId)).emit(EVENTS.presenceUpdate, message)
    })

    socket.on('disconnecting', () => {
      for (const boardId of [...data.boards]) leaveBoard(boardId)
    })
  })

  return io
}
