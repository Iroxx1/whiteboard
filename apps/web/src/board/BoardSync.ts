import { CaptureUpdateAction, reconcileElements } from '@excalidraw/excalidraw'
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile'
import type { ExcalidrawElement, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, Collaborator, ExcalidrawImperativeAPI, SocketId } from '@excalidraw/excalidraw/types'
import {
  type BoardAppState,
  type BoardUpdate,
  type ClaimAck,
  EVENTS,
  type ItemUpdated,
  type JoinAck,
  type PlacementDoneAck,
  type PlacementPending,
  type PresenceBroadcast,
  type PresenceLeave,
  type PresencePointer,
  type SceneElement,
  type UpdateAck,
} from '@wb/shared'
import { io, type Socket } from 'socket.io-client'
import { changedIds, mergeAfterJoin } from './syncCore.ts'

export type SyncStatus = 'connecting' | 'connected' | 'disconnected' | 'unauthorized' | 'not_found' | 'deleted'

type Hooks = {
  onStatus: (status: SyncStatus) => void
  /** Elements that arrived from the server (to fetch missing image files). */
  onRemoteElements: (elements: readonly ExcalidrawElement[]) => void
  onInboxChanged?: () => void
  onItemUpdated?: (itemId: string) => void
  /** Items with this board as target that wait in the inbox (join and placement:pending). */
  onPlacementPending?: (itemIds: string[]) => void
}

const FLUSH_DELAY_MS = 80
const PRESENCE_INTERVAL_MS = 50
const ACK_TIMEOUT_MS = 10_000

const asScene = (elements: readonly ExcalidrawElement[]) => elements as unknown as SceneElement[]
const asExcalidraw = (elements: readonly SceneElement[]) => elements as unknown as OrderedExcalidrawElement[]

function boardAppStateOf(appState: AppState): BoardAppState {
  return { viewBackgroundColor: appState.viewBackgroundColor, gridModeEnabled: appState.gridModeEnabled }
}

/**
 * Real-time sync of one board (PLAN.md 5.3): local changes go to the server throttled to ~80 ms,
 * remote changes are reconciled without entering the local undo history, and after a reconnect the
 * server state wins except for local changes that were never confirmed.
 */
export class BoardSync {
  private readonly socket: Socket
  /** Version of each element the server is known to have. */
  private known = new Map<string, number>()
  /** Changed locally and not yet confirmed by the server. */
  private pending = new Set<string>()
  private inFlight = false
  private joined = false
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private boardAppState: BoardAppState
  private appStateDirty = false
  private readonly collaborators = new Map<SocketId, Collaborator>()
  private lastPresenceAt = 0
  private presenceTimer: ReturnType<typeof setTimeout> | undefined
  private lastPointer: { pointer: PresencePointer | null; button: 'up' | 'down' } = { pointer: null, button: 'up' }
  private lastSelection: AppState['selectedElementIds'] | undefined
  private stopped = false

  constructor(
    private readonly boardId: string,
    private readonly api: ExcalidrawImperativeAPI,
    initial: { elements: readonly SceneElement[]; appState: BoardAppState },
    private readonly hooks: Hooks,
  ) {
    for (const element of initial.elements) this.known.set(element.id, element.version)
    this.boardAppState = initial.appState
    this.socket = io({ path: '/socket.io', withCredentials: true })
    this.socket.on('connect', () => void this.join())
    this.socket.on('disconnect', () => {
      this.joined = false
      this.clearCollaborators()
      if (!this.stopped) this.hooks.onStatus('disconnected')
    })
    this.socket.on('connect_error', (error) => {
      if (error.message === 'unauthorized') this.hooks.onStatus('unauthorized')
      else this.hooks.onStatus('disconnected')
    })
    this.socket.on(EVENTS.boardUpdate, (payload: BoardUpdate) => this.applyRemote(payload))
    this.socket.on(EVENTS.presenceUpdate, (payload: PresenceBroadcast) => this.applyPresence(payload))
    this.socket.on(EVENTS.presenceLeave, (payload: PresenceLeave) => {
      if (payload.boardId !== this.boardId) return
      this.collaborators.delete(payload.socketId as SocketId)
      this.api.updateScene({ collaborators: new Map(this.collaborators) })
    })
    this.socket.on(EVENTS.inboxChanged, () => this.hooks.onInboxChanged?.())
    this.socket.on(EVENTS.itemUpdated, (payload: ItemUpdated) => this.hooks.onItemUpdated?.(payload.itemId))
    this.socket.on(EVENTS.placementPending, (payload: PlacementPending) => {
      if (payload.boardId === this.boardId) this.hooks.onPlacementPending?.(payload.itemIds)
    })
    this.socket.on(EVENTS.boardsChanged, (payload: { boardId?: string; deleted?: boolean }) => {
      if (payload.boardId === this.boardId && payload.deleted) this.hooks.onStatus('deleted')
    })
  }

  get isJoined() {
    return this.joined
  }

  private async join() {
    this.hooks.onStatus('connecting')
    let ack: JoinAck
    try {
      ack = await this.socket.timeout(ACK_TIMEOUT_MS).emitWithAck(EVENTS.boardJoin, { boardId: this.boardId })
    } catch {
      this.socket.disconnect().connect()
      return
    }
    if (!ack.ok) {
      this.hooks.onStatus('not_found')
      return
    }
    const local = asScene(this.api.getSceneElementsIncludingDeleted())
    const { scene, resend } = mergeAfterJoin(local, ack.elements, this.pending)
    this.known = new Map(ack.elements.map((element) => [element.id, element.version]))
    this.pending = new Set(resend.map((element) => element.id))
    this.boardAppState = { ...this.boardAppState, ...ack.appState }
    this.api.updateScene({
      elements: asExcalidraw(scene),
      appState: ack.appState as AppState,
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    this.joined = true
    this.hooks.onStatus('connected')
    this.hooks.onRemoteElements(asExcalidraw(scene))
    this.flush()
    // Data may have changed while disconnected.
    this.hooks.onInboxChanged?.()
    if (ack.pendingItemIds.length > 0) this.hooks.onPlacementPending?.(ack.pendingItemIds)
  }

  // --- placement protocol (PLAN.md 5.4) ---

  async claim(itemId: string): Promise<{ granted: true } | { granted: false; holder: string | null }> {
    const ack = (await this.socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(EVENTS.placementClaim, { itemId, boardId: this.boardId })) as ClaimAck
    if (!ack.ok) return { granted: false, holder: null }
    return ack.granted ? { granted: true } : { granted: false, holder: ack.holder }
  }

  /** Sends the given elements right away (not throttled), so placement:done finds them on the server. */
  async sendNow(elementIds: string[]) {
    const byId = new Map(this.api.getSceneElementsIncludingDeleted().map((element) => [element.id, element]))
    const elements = elementIds.flatMap((id) => (byId.get(id) as unknown as SceneElement | undefined) ?? [])
    const ack = (await this.socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(EVENTS.boardUpdate, { boardId: this.boardId, elements })) as UpdateAck
    if (!ack.ok) throw new Error(ack.error)
    for (const element of elements) {
      this.known.set(element.id, element.version)
      if (byId.get(element.id)?.version === element.version) this.pending.delete(element.id)
    }
  }

  async done(itemId: string, elementIds: string[]): Promise<boolean> {
    const ack = (await this.socket
      .timeout(ACK_TIMEOUT_MS)
      .emitWithAck(EVENTS.placementDone, { itemId, boardId: this.boardId, elementIds })) as PlacementDoneAck
    return ack.ok
  }

  /** Called from Excalidraw's onChange. */
  handleChange(elements: readonly ExcalidrawElement[], appState: AppState) {
    for (const id of changedIds(asScene(elements), this.known)) this.pending.add(id)
    const next = boardAppStateOf(appState)
    if (
      next.viewBackgroundColor !== this.boardAppState.viewBackgroundColor ||
      next.gridModeEnabled !== this.boardAppState.gridModeEnabled
    ) {
      this.boardAppState = next
      this.appStateDirty = true
    }
    if (this.pending.size > 0 || this.appStateDirty) this.scheduleFlush()
    if (appState.selectedElementIds !== this.lastSelection) {
      this.lastSelection = appState.selectedElementIds
      this.sendPresence()
    }
  }

  private scheduleFlush() {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flush()
    }, FLUSH_DELAY_MS)
  }

  private async flush() {
    if (!this.joined || this.inFlight || (this.pending.size === 0 && !this.appStateDirty)) return
    const byId = new Map(this.api.getSceneElementsIncludingDeleted().map((element) => [element.id, element]))
    const elements: SceneElement[] = []
    for (const id of this.pending) {
      const element = byId.get(id)
      if (element) elements.push(element as unknown as SceneElement)
      else this.pending.delete(id)
    }
    const appState = this.appStateDirty ? this.boardAppState : undefined
    if (elements.length === 0 && !appState) return

    this.inFlight = true
    this.appStateDirty = false
    let ack: UpdateAck | undefined
    try {
      ack = await this.socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck(EVENTS.boardUpdate, { boardId: this.boardId, elements, ...(appState ? { appState } : {}) })
    } catch {
      // Timeout or disconnect: everything stays pending and is sent again after the next join.
      if (appState) this.appStateDirty = true
    } finally {
      this.inFlight = false
    }
    if (ack?.ok) {
      const current = new Map(this.api.getSceneElementsIncludingDeleted().map((element) => [element.id, element]))
      for (const element of elements) {
        this.known.set(element.id, element.version)
        if (current.get(element.id)?.version === element.version) this.pending.delete(element.id)
      }
    } else if (ack && !ack.ok) {
      if (ack.error === 'not_found') this.hooks.onStatus('deleted')
      else if (ack.error === 'not_joined') void this.join()
      return
    }
    if (this.pending.size > 0 || this.appStateDirty) this.scheduleFlush()
  }

  private applyRemote(payload: BoardUpdate) {
    if (payload.boardId !== this.boardId || !this.joined) return
    const local = this.api.getSceneElementsIncludingDeleted() as readonly OrderedExcalidrawElement[]
    const remote = asExcalidraw(payload.elements) as unknown as RemoteExcalidrawElement[]
    const reconciled = reconcileElements(local, remote, this.api.getAppState())
    const result = new Map(reconciled.map((element) => [element.id, element]))
    // Remember what the server has before updateScene triggers onChange.
    for (const element of payload.elements) {
      if (result.get(element.id)?.version === element.version) this.known.set(element.id, element.version)
    }
    if (payload.appState) this.boardAppState = { ...this.boardAppState, ...payload.appState }
    this.api.updateScene({
      elements: reconciled,
      ...(payload.appState ? { appState: payload.appState as AppState } : {}),
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    this.hooks.onRemoteElements(remote)
  }

  /** Called from Excalidraw's onPointerUpdate. */
  handlePointer(pointer: PresencePointer, button: 'up' | 'down') {
    this.lastPointer = { pointer, button }
    this.sendPresence()
  }

  private sendPresence() {
    if (!this.joined) return
    const wait = this.lastPresenceAt + PRESENCE_INTERVAL_MS - Date.now()
    if (wait > 0) {
      this.presenceTimer ??= setTimeout(() => {
        this.presenceTimer = undefined
        this.sendPresence()
      }, wait)
      return
    }
    this.lastPresenceAt = Date.now()
    this.socket.volatile.emit(EVENTS.presenceUpdate, {
      boardId: this.boardId,
      pointer: this.lastPointer.pointer,
      button: this.lastPointer.button,
      selectedElementIds: { ...(this.api.getAppState().selectedElementIds as Record<string, true>) },
    })
  }

  private applyPresence(payload: PresenceBroadcast) {
    if (payload.boardId !== this.boardId) return
    this.collaborators.set(payload.socketId as SocketId, {
      id: payload.userId,
      socketId: payload.socketId as SocketId,
      username: payload.name,
      color: payload.color,
      button: payload.button,
      selectedElementIds: payload.selectedElementIds,
      ...(payload.pointer ? { pointer: payload.pointer } : {}),
    })
    this.api.updateScene({ collaborators: new Map(this.collaborators) })
  }

  private clearCollaborators() {
    if (this.collaborators.size === 0) return
    this.collaborators.clear()
    this.api.updateScene({ collaborators: new Map() })
  }

  stop() {
    this.stopped = true
    clearTimeout(this.flushTimer)
    clearTimeout(this.presenceTimer)
    if (this.joined) {
      // Last unsent changes go out before leaving (packets are sent in order).
      const byId = new Map(this.api.getSceneElementsIncludingDeleted().map((element) => [element.id, element]))
      const elements = [...this.pending].flatMap((id) => byId.get(id) ?? [])
      if (elements.length > 0 || this.appStateDirty) {
        this.socket.emit(EVENTS.boardUpdate, {
          boardId: this.boardId,
          elements,
          ...(this.appStateDirty ? { appState: this.boardAppState } : {}),
        })
      }
      this.socket.emit(EVENTS.boardLeave, { boardId: this.boardId })
    }
    this.socket.disconnect()
  }
}
