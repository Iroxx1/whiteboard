import { randomInt } from 'node:crypto'
import {
  type BoardAppState,
  compareByIndex,
  EVENTS,
  incomingWins,
  type SceneElement,
  type SnapshotInfo,
  type SnapshotReason,
  ulid,
} from '@wb/shared'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { FastifyBaseLogger as Logger } from 'fastify'
import type { Db } from '../db/index.ts'
import { boardSnapshots, boards } from '../db/schema.ts'
import type { RealtimeHub } from '../realtime/hub.ts'
import { parseAppStateJson, parseElementsJson } from './elements.ts'
import {
  decodeSnapshot,
  encodeSnapshot,
  expiredTombstones,
  SNAPSHOT_INTERVAL_MS,
  snapshotsToDelete,
} from './snapshots.ts'

type Room = {
  id: string
  elements: Map<string, SceneElement>
  appState: BoardAppState
  version: number
  dirty: boolean
  lastChangedBy: string | null
  members: Set<string>
  saveTimer: NodeJS.Timeout | undefined
  unloadTimer: NodeJS.Timeout | undefined
  lastSnapshotAt: number
  changedSinceSnapshot: boolean
  lastListNoticeAt: number
}

export type BoardState = { version: number; elements: SceneElement[]; appState: BoardAppState }

export type RoomOptions = { saveDelayMs: number; unloadDelayMs: number }

const DEFAULT_OPTIONS: RoomOptions = { saveDelayMs: 2000, unloadDelayMs: 5 * 60 * 1000 }
/** How often a busy board tells dashboards that it changed. */
const LIST_NOTICE_INTERVAL_MS = 10_000

const newNonce = () => randomInt(0, 2 ** 31)

/**
 * In-memory board state (PLAN.md 5.3): loaded on first join, reconciled per element with the
 * Excalidraw rule, saved 2 s after the last change, on the last leave and on shutdown, and dropped
 * 5 minutes after the last member left.
 */
export class BoardRooms {
  private readonly rooms = new Map<string, Room>()
  private readonly options: RoomOptions

  constructor(
    private readonly db: Db,
    private readonly hub: RealtimeHub,
    private readonly log: Logger,
    options: Partial<RoomOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  private load(boardId: string): Room | null {
    const existing = this.rooms.get(boardId)
    if (existing) return existing
    const row = this.db
      .select({
        version: boards.version,
        elementsJson: boards.elementsJson,
        appStateJson: boards.appStateJson,
      })
      .from(boards)
      .where(and(eq(boards.id, boardId), isNull(boards.deletedAt)))
      .get()
    if (!row) return null
    const last = this.db
      .select({ createdAt: boardSnapshots.createdAt })
      .from(boardSnapshots)
      .where(eq(boardSnapshots.boardId, boardId))
      .orderBy(asc(boardSnapshots.createdAt))
      .all()
      .at(-1)
    const room: Room = {
      id: boardId,
      elements: new Map(parseElementsJson(row.elementsJson).map((element) => [element.id, element])),
      appState: parseAppStateJson(row.appStateJson),
      version: row.version,
      dirty: false,
      lastChangedBy: null,
      members: new Set(),
      saveTimer: undefined,
      unloadTimer: undefined,
      lastSnapshotAt: last?.createdAt ?? 0,
      changedSinceSnapshot: last === undefined,
      lastListNoticeAt: 0,
    }
    this.rooms.set(boardId, room)
    this.scheduleUnload(room)
    return room
  }

  private snapshotOf(room: Room): BoardState {
    return {
      version: room.version,
      elements: [...room.elements.values()].sort(compareByIndex),
      appState: room.appState,
    }
  }

  /** Current state: from memory if the board is loaded, otherwise from the database. */
  state(boardId: string): BoardState | null {
    const room = this.rooms.get(boardId)
    if (room) return this.snapshotOf(room)
    const row = this.db
      .select({ version: boards.version, elementsJson: boards.elementsJson, appStateJson: boards.appStateJson })
      .from(boards)
      .where(and(eq(boards.id, boardId), isNull(boards.deletedAt)))
      .get()
    if (!row) return null
    return {
      version: row.version,
      elements: parseElementsJson(row.elementsJson),
      appState: parseAppStateJson(row.appStateJson),
    }
  }

  join(boardId: string, socketId: string): BoardState | null {
    const room = this.load(boardId)
    if (!room) return null
    room.members.add(socketId)
    clearTimeout(room.unloadTimer)
    room.unloadTimer = undefined
    return this.snapshotOf(room)
  }

  leave(boardId: string, socketId: string) {
    const room = this.rooms.get(boardId)
    if (!room?.members.delete(socketId)) return
    if (room.members.size === 0) {
      this.save(room)
      this.scheduleUnload(room)
    }
  }

  isMember(boardId: string, socketId: string): boolean {
    return this.rooms.get(boardId)?.members.has(socketId) ?? false
  }

  /**
   * Reconciles incoming elements; returns what was accepted (to be sent to the others), or null if
   * the board does not exist (any more).
   */
  applyUpdate(
    boardId: string,
    userId: string,
    incoming: SceneElement[],
    appState?: BoardAppState,
  ): { elements: SceneElement[]; appState?: BoardAppState } | null {
    const room = this.load(boardId)
    if (!room) return null
    const accepted: SceneElement[] = []
    for (const element of incoming) {
      if (incomingWins(room.elements.get(element.id), element)) {
        room.elements.set(element.id, element)
        accepted.push(element)
      }
    }
    let acceptedAppState: BoardAppState | undefined
    if (appState && Object.keys(appState).length > 0) {
      room.appState = { ...room.appState, ...appState }
      acceptedAppState = appState
    }
    if (accepted.length > 0 || acceptedAppState) this.markChanged(room, userId)
    return { elements: accepted, ...(acceptedAppState ? { appState: acceptedAppState } : {}) }
  }

  private markChanged(room: Room, userId: string | null) {
    room.dirty = true
    room.changedSinceSnapshot = true
    room.lastChangedBy = userId
    clearTimeout(room.saveTimer)
    room.saveTimer = setTimeout(() => this.save(room), this.options.saveDelayMs)
  }

  private scheduleUnload(room: Room) {
    clearTimeout(room.unloadTimer)
    room.unloadTimer = setTimeout(() => {
      if (room.members.size > 0) return
      this.save(room)
      clearTimeout(room.saveTimer)
      this.rooms.delete(room.id)
    }, this.options.unloadDelayMs)
    room.unloadTimer.unref()
  }

  /** Writes the board atomically and takes an automatic snapshot when one is due. */
  private save(room: Room, now = Date.now()) {
    clearTimeout(room.saveTimer)
    room.saveTimer = undefined
    if (!room.dirty) return
    try {
      this.db.transaction(() => {
        if (room.changedSinceSnapshot && now - room.lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
          this.writeSnapshot(room, room.lastChangedBy, 'auto', now)
        }
        const result = this.db
          .update(boards)
          .set({
            elementsJson: JSON.stringify(this.snapshotOf(room).elements),
            appStateJson: JSON.stringify(room.appState),
            version: room.version + 1,
            updatedAt: now,
            updatedBy: room.lastChangedBy,
          })
          .where(eq(boards.id, room.id))
          .run()
        if (result.changes !== 1) throw new Error('board row missing')
      })
      room.version += 1
      room.dirty = false
      if (now - room.lastListNoticeAt >= LIST_NOTICE_INTERVAL_MS) {
        room.lastListNoticeAt = now
        this.hub.toAll(EVENTS.boardsChanged, { boardId: room.id })
      }
    } catch (error) {
      this.log.error({ err: error, boardId: room.id }, 'saving board failed')
      // Keep the state dirty and try again later.
      room.saveTimer = setTimeout(() => this.save(room), this.options.saveDelayMs * 5)
    }
  }

  /** Drops expired tombstones, stores a snapshot and applies the retention rules. */
  private writeSnapshot(room: Room, userId: string | null, reason: SnapshotReason, now: number): SnapshotInfo {
    for (const id of expiredTombstones(room.elements.values(), now)) {
      room.elements.delete(id)
      room.dirty = true
    }
    const { elements, appState } = this.snapshotOf(room)
    const id = ulid(now)
    this.db
      .insert(boardSnapshots)
      .values({
        id,
        boardId: room.id,
        createdAt: now,
        createdBy: userId,
        reason,
        elementCount: elements.filter((element) => !element.isDeleted).length,
        elementsGz: encodeSnapshot({ elements, appState }),
      })
      .run()
    room.lastSnapshotAt = now
    room.changedSinceSnapshot = false

    const existing = this.db
      .select({ id: boardSnapshots.id, createdAt: boardSnapshots.createdAt, reason: boardSnapshots.reason })
      .from(boardSnapshots)
      .where(eq(boardSnapshots.boardId, room.id))
      .all()
    for (const removeId of snapshotsToDelete(existing, now)) {
      this.db.delete(boardSnapshots).where(eq(boardSnapshots.id, removeId)).run()
    }
    return {
      id,
      createdAt: now,
      createdByName: null,
      reason,
      elementCount: elements.filter((element) => !element.isDeleted).length,
    }
  }

  /** "Save version now" (PLAN.md 4.6). */
  createSnapshot(boardId: string, userId: string, reason: SnapshotReason = 'manual'): SnapshotInfo | null {
    const room = this.load(boardId)
    if (!room) return null
    const now = Date.now()
    let info: SnapshotInfo | undefined
    this.db.transaction(() => {
      info = this.writeSnapshot(room, userId, reason, now)
    })
    // Tombstones may have been dropped; persist that.
    this.save(room, now)
    return info ?? null
  }

  /**
   * Restores a snapshot (PLAN.md 5.3): snapshot the current state first, mark elements missing in
   * the target as deleted, take over the snapshot's elements, and give every touched element a
   * higher version so connected clients accept it.
   */
  restore(boardId: string, snapshotId: string, userId: string): boolean {
    const room = this.load(boardId)
    if (!room) return false
    const row = this.db
      .select({ elementsGz: boardSnapshots.elementsGz })
      .from(boardSnapshots)
      .where(and(eq(boardSnapshots.id, snapshotId), eq(boardSnapshots.boardId, boardId)))
      .get()
    if (!row) return false
    const target = decodeSnapshot(row.elementsGz)
    const now = Date.now()

    this.db.transaction(() => {
      this.writeSnapshot(room, userId, 'before_restore', now)
    })

    const targetIds = new Set(target.elements.map((element) => element.id))
    const changed: SceneElement[] = []
    for (const current of room.elements.values()) {
      if (targetIds.has(current.id) || current.isDeleted) continue
      const next = { ...current, isDeleted: true, version: current.version + 1, versionNonce: newNonce(), updated: now }
      room.elements.set(next.id, next)
      changed.push(next)
    }
    for (const element of target.elements) {
      const current = room.elements.get(element.id)
      const next = {
        ...element,
        version: Math.max(current?.version ?? 0, element.version) + 1,
        versionNonce: newNonce(),
        updated: now,
      }
      room.elements.set(next.id, next)
      changed.push(next)
    }
    room.appState = target.appState
    this.markChanged(room, userId)
    this.save(room, now)
    this.hub.toBoard(boardId, EVENTS.boardUpdate, { boardId, elements: changed, appState: room.appState })
    return true
  }

  /** Saves and forgets a board, e.g. after it was moved to the trash. */
  evict(boardId: string) {
    const room = this.rooms.get(boardId)
    if (!room) return
    this.save(room)
    clearTimeout(room.saveTimer)
    clearTimeout(room.unloadTimer)
    this.rooms.delete(boardId)
  }

  flushAll() {
    for (const room of this.rooms.values()) this.save(room)
  }

  close() {
    this.flushAll()
    for (const room of this.rooms.values()) {
      clearTimeout(room.saveTimer)
      clearTimeout(room.unloadTimer)
    }
    this.rooms.clear()
  }
}
