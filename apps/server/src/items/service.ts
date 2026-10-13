import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  type AssetInfo,
  type AssetRole,
  EVENTS,
  type IngestResult,
  type Item,
  type ItemDetail,
  type ItemKind,
  type ItemMeta,
  type ItemStatus,
  type PlacementPending,
  ulid,
} from '@wb/shared'
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { FastifyBaseLogger as Logger } from 'fastify'
import type { Db } from '../db/index.ts'
import { assets, boards, itemPlacements, items, itemTexts, users } from '../db/schema.ts'
import { type IngestPayload, normalizePayload } from '../ingest/normalize.ts'
import type { JobQueue } from '../jobs/queue.ts'
import { diskFilename } from '../lib/mime.ts'
import type { RealtimeHub } from '../realtime/hub.ts'

/** Items in the trash are deleted for good after this time (PLAN.md 4.4). */
export const ITEM_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

type ItemRow = typeof items.$inferSelect

const JOB_FOR_KIND: Partial<Record<ItemKind, string>> = {
  link: 'unfurl_link',
  image: 'process_image',
  pdf: 'process_pdf',
  audio: 'process_audio',
  video: 'process_video',
  document: 'process_document',
  file: 'process_document',
}

export class IngestError extends Error {
  override name = 'IngestError'
}

const creator = alias(users, 'creator')
const target = alias(boards, 'target')

/** Inbox items: ingest, queries, status changes and their live events (PLAN.md 5.4, 5.5). */
export class ItemService {
  private queue: JobQueue | undefined
  readonly filesDir: string

  constructor(
    private readonly db: Db,
    private readonly hub: RealtimeHub,
    private readonly log: Logger,
    dataDir: string,
  ) {
    this.filesDir = path.join(dataDir, 'files')
  }

  attachQueue(queue: JobQueue) {
    this.queue = queue
  }

  /** Merges metadata without events (bookkeeping such as ocrDone). */
  patchMeta(itemId: string, meta: ItemMeta) {
    const current = this.row(itemId)
    if (!current) return
    this.db
      .update(items)
      .set({ metaJson: JSON.stringify({ ...(JSON.parse(current.metaJson) as ItemMeta), ...meta }) })
      .where(eq(items.id, itemId))
      .run()
  }

  /** Image and PDF items whose text recognition has not run yet (backfill, Phase 8). */
  withoutOcr(): { id: string; kind: ItemKind }[] {
    return this.db
      .select({ id: items.id, kind: items.kind, metaJson: items.metaJson })
      .from(items)
      .where(and(inArray(items.kind, ['image', 'pdf']), ne(items.status, 'trashed'), eq(items.processing, 'ready')))
      .all()
      .filter((row) => !(JSON.parse(row.metaJson) as ItemMeta).ocrDone)
      .map((row) => ({ id: row.id, kind: row.kind }))
  }

  /** Follow-up jobs of processors (e.g. extract_article after unfurl_link). */
  queueJob(type: string, payload: Record<string, unknown>) {
    this.queue?.enqueue(type, payload)
  }

  /** Search index (Phase 7): told about every change of an item; removed items are dropped. */
  onIndex: ((itemId: string) => void) | undefined
  onRemoved: ((itemId: string) => void) | undefined

  private reindex(itemId: string) {
    try {
      this.onIndex?.(itemId)
    } catch (error) {
      this.log.error({ err: error, itemId }, 'search index update failed')
    }
  }

  // --- events -------------------------------------------------------------------------------

  inboxChanged() {
    this.hub.toAll(EVENTS.inboxChanged, {})
  }

  itemUpdated(itemId: string) {
    this.reindex(itemId)
    this.hub.toAll(EVENTS.itemUpdated, { itemId })
  }

  /** Tells open boards about items waiting to be placed there (PLAN.md 5.4 "Automatische Ablage"). */
  announcePending(boardId: string, itemIds: string[]) {
    if (itemIds.length > 0)
      this.hub.toBoard(boardId, EVENTS.placementPending, { boardId, itemIds } satisfies PlacementPending)
  }

  // --- ingest -------------------------------------------------------------------------------

  boardsByHashtag(): Map<string, string> {
    const rows = this.db
      .select({ id: boards.id, hashtag: boards.hashtag })
      .from(boards)
      .where(isNull(boards.deletedAt))
      .all()
    return new Map(rows.map((row) => [row.hashtag, row.id]))
  }

  private boardExists(boardId: string) {
    return Boolean(
      this.db
        .select({ id: boards.id })
        .from(boards)
        .where(and(eq(boards.id, boardId), isNull(boards.deletedAt)))
        .get(),
    )
  }

  /** Normalises, stores files, creates items and queues their processing (PLAN.md 5.5). */
  async ingest(
    payload: IngestPayload,
    options: { groupId?: string } = {},
  ): Promise<IngestResult & { unknownHashtags: string[] }> {
    const normalized = await normalizePayload(payload, this.boardsByHashtag())
    if (normalized.drafts.length === 0) throw new IngestError('empty')
    const targetBoardId =
      normalized.targetBoardId && this.boardExists(normalized.targetBoardId) ? normalized.targetBoardId : null
    const now = Date.now()
    // A share uploaded in several requests keeps one group (PLAN.md 5.6).
    const groupId = options.groupId ?? (normalized.drafts.length > 1 ? ulid(now) : null)
    const created: string[] = []
    const duplicateIds: string[] = []
    const jobsToQueue: { type: string; itemId: string }[] = []

    for (const draft of normalized.drafts) {
      // Same link already waiting in the inbox: reuse it, append the note, take over the board.
      if (draft.kind === 'link' && draft.urlNormalized) {
        const existing = this.db
          .select()
          .from(items)
          .where(and(eq(items.urlNormalized, draft.urlNormalized), eq(items.status, 'inbox')))
          .get()
        if (existing) {
          const note =
            draft.note && draft.note !== existing.note
              ? [existing.note, draft.note].filter(Boolean).join('\n\n')
              : existing.note
          this.db
            .update(items)
            .set({ note, targetBoardId: targetBoardId ?? existing.targetBoardId, updatedAt: now })
            .where(eq(items.id, existing.id))
            .run()
          duplicateIds.push(existing.id)
          continue
        }
      }
      const id = ulid(now)
      const file = draft.fileIndex !== null ? payload.files[draft.fileIndex] : undefined
      this.db.transaction(() => {
        this.db
          .insert(items)
          .values({
            id,
            createdAt: now,
            createdBy: payload.userId,
            source: payload.source,
            kind: draft.kind,
            title: draft.title,
            note: draft.note,
            url: draft.url,
            urlNormalized: draft.urlNormalized,
            groupId,
            targetBoardId,
            processing: JOB_FOR_KIND[draft.kind] ? 'pending' : 'ready',
            metaJson: JSON.stringify(draft.meta),
            updatedAt: now,
          })
          .run()
        if (file) {
          this.addAssetFromFile(
            id,
            'original',
            file.tmpPath,
            draft.meta.mime ?? 'application/octet-stream',
            draft.meta.filename ?? 'datei',
            {
              move: true,
            },
          )
        }
      })
      created.push(id)
      const job = JOB_FOR_KIND[draft.kind]
      if (job) jobsToQueue.push({ type: job, itemId: id })
    }

    for (const job of jobsToQueue) this.queue?.enqueue(job.type, { itemId: job.itemId })
    for (const id of created) this.reindex(id)
    this.inboxChanged()
    for (const id of duplicateIds) this.itemUpdated(id)
    if (targetBoardId) this.announcePending(targetBoardId, [...created, ...duplicateIds])
    this.log.info(
      { source: payload.source, created: created.length, duplicates: duplicateIds.length },
      'items ingested',
    )

    return {
      items: this.byIds([...created, ...duplicateIds]),
      duplicateIds,
      unknownHashtags: normalized.unknownHashtags,
    }
  }

  // --- assets -------------------------------------------------------------------------------

  private assetDir(itemId: string, createdAt: number) {
    const date = new Date(createdAt)
    const year = String(date.getUTCFullYear())
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    return path.posix.join('items', year, month, itemId)
  }

  private itemCreatedAt(itemId: string) {
    return (
      this.db.select({ createdAt: items.createdAt }).from(items).where(eq(items.id, itemId)).get()?.createdAt ??
      Date.now()
    )
  }

  /** Stores a file for an item under /data/files/items/<yyyy>/<mm>/<itemId>/<role>-<name>. */
  addAssetFromFile(
    itemId: string,
    role: AssetRole,
    source: string,
    mime: string,
    name: string,
    options: { move?: boolean; width?: number | null; height?: number | null } = {},
  ): string {
    const relative = path.posix.join(this.assetDir(itemId, this.itemCreatedAt(itemId)), `${role}-${diskFilename(name)}`)
    const target = path.join(this.filesDir, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (options.move) {
      try {
        fs.renameSync(source, target)
      } catch {
        fs.copyFileSync(source, target)
        fs.rmSync(source, { force: true })
      }
    } else {
      fs.copyFileSync(source, target)
    }
    return this.insertAsset(itemId, role, relative, mime, options.width ?? null, options.height ?? null)
  }

  addAssetFromBuffer(
    itemId: string,
    role: AssetRole,
    data: Buffer,
    mime: string,
    name: string,
    size?: { width?: number; height?: number },
  ) {
    const relative = path.posix.join(this.assetDir(itemId, this.itemCreatedAt(itemId)), `${role}-${diskFilename(name)}`)
    const target = path.join(this.filesDir, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, data)
    return this.insertAsset(itemId, role, relative, mime, size?.width ?? null, size?.height ?? null)
  }

  private insertAsset(
    itemId: string,
    role: AssetRole,
    relative: string,
    mime: string,
    width: number | null,
    height: number | null,
  ) {
    const file = path.join(this.filesDir, relative)
    const data = fs.readFileSync(file)
    // One asset per role; a reprocessing run replaces the previous one.
    for (const old of this.db
      .select()
      .from(assets)
      .where(and(eq(assets.itemId, itemId), eq(assets.role, role)))
      .all()) {
      if (old.path !== relative) fs.rmSync(path.join(this.filesDir, old.path), { force: true })
      this.db.delete(assets).where(eq(assets.id, old.id)).run()
    }
    const id = ulid()
    this.db
      .insert(assets)
      .values({
        id,
        itemId,
        role,
        mime,
        size: data.length,
        width,
        height,
        sha256: createHash('sha256').update(data).digest('hex'),
        path: relative,
        createdAt: Date.now(),
      })
      .run()
    return id
  }

  assetPath(itemId: string, role: AssetRole): { file: string; mime: string } | null {
    const row = this.db
      .select({ path: assets.path, mime: assets.mime })
      .from(assets)
      .where(and(eq(assets.itemId, itemId), eq(assets.role, role)))
      .get()
    return row ? { file: path.join(this.filesDir, row.path), mime: row.mime } : null
  }

  // --- queries ------------------------------------------------------------------------------

  row(id: string): ItemRow | undefined {
    return this.db.select().from(items).where(eq(items.id, id)).get()
  }

  private serialize(rows: { item: ItemRow; createdByName: string | null; targetBoardName: string | null }[]): Item[] {
    const ids = rows.map((row) => row.item.id)
    const assetRows = ids.length > 0 ? this.db.select().from(assets).where(inArray(assets.itemId, ids)).all() : []
    const byItem = new Map<string, Partial<Record<AssetRole, AssetInfo>>>()
    for (const asset of assetRows) {
      if (!asset.itemId || asset.role === 'board_file') continue
      const entry = byItem.get(asset.itemId) ?? {}
      entry[asset.role] = { id: asset.id, mime: asset.mime, size: asset.size, width: asset.width, height: asset.height }
      byItem.set(asset.itemId, entry)
    }
    return rows.map(({ item, createdByName, targetBoardName }) => ({
      id: item.id,
      createdAt: item.createdAt,
      createdByName,
      source: item.source,
      kind: item.kind,
      status: item.status,
      title: item.title,
      note: item.note,
      url: item.url,
      groupId: item.groupId,
      targetBoardId: item.targetBoardId,
      targetBoardName,
      processing: item.processing,
      processingError: item.processingError,
      meta: JSON.parse(item.metaJson) as ItemMeta,
      updatedAt: item.updatedAt,
      trashedAt: item.trashedAt,
      assets: byItem.get(item.id) ?? {},
    }))
  }

  private selectItems() {
    return this.db
      .select({ item: items, createdByName: creator.name, targetBoardName: target.name })
      .from(items)
      .leftJoin(creator, eq(creator.id, items.createdBy))
      .leftJoin(target, eq(target.id, items.targetBoardId))
  }

  byIds(ids: string[]): Item[] {
    if (ids.length === 0) return []
    const rows = this.selectItems().where(inArray(items.id, ids)).all()
    const order = new Map(ids.map((id, index) => [id, index]))
    return this.serialize(rows).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  }

  /** Newest first; the cursor is the last item's id (ULIDs sort by time). */
  list(
    status: ItemStatus,
    kinds: ItemKind[] | null,
    cursor: string | null,
    limit: number,
  ): { items: Item[]; nextCursor: string | null } {
    const conditions = [eq(items.status, status)]
    if (kinds && kinds.length > 0) conditions.push(inArray(items.kind, kinds))
    if (cursor) conditions.push(lt(items.id, cursor))
    const rows = this.selectItems()
      .where(and(...conditions))
      .orderBy(desc(items.id))
      .limit(limit + 1)
      .all()
    const page = rows.slice(0, limit)
    return { items: this.serialize(page), nextCursor: rows.length > limit ? (page.at(-1)?.item.id ?? null) : null }
  }

  detail(id: string): ItemDetail | null {
    const [item] = this.byIds([id])
    if (!item) return null
    const texts = this.db
      .select({ kind: itemTexts.kind, text: itemTexts.text })
      .from(itemTexts)
      .where(eq(itemTexts.itemId, id))
      .all()
    const placements = this.db
      .selectDistinct({ boardId: boards.id, boardName: boards.name, deletedAt: boards.deletedAt })
      .from(itemPlacements)
      .innerJoin(boards, eq(boards.id, itemPlacements.boardId))
      .where(eq(itemPlacements.itemId, id))
      .orderBy(asc(boards.name))
      .all()
      .map((row) => ({ boardId: row.boardId, boardName: row.boardName, deleted: row.deletedAt !== null }))
    return { ...item, texts, placements }
  }

  /** Link items without reading text (backfill when the search starts, Phase 7). */
  linksWithoutArticle(): string[] {
    return this.db
      .select({ id: items.id })
      .from(items)
      .leftJoin(itemTexts, and(eq(itemTexts.itemId, items.id), eq(itemTexts.kind, 'article')))
      .where(and(eq(items.kind, 'link'), ne(items.status, 'trashed'), isNull(itemTexts.itemId)))
      .all()
      .map((row) => row.id)
  }

  /** Items with a target board that still wait in the inbox (for board:join, PLAN.md 5.4). */
  pendingFor(boardId: string): string[] {
    return this.db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.targetBoardId, boardId), eq(items.status, 'inbox')))
      .orderBy(asc(items.id))
      .all()
      .map((row) => row.id)
  }

  // --- changes ------------------------------------------------------------------------------

  update(
    id: string,
    changes: {
      title?: string | null
      note?: string | null
      targetBoardId?: string | null
      status?: 'inbox' | 'archived'
    },
  ) {
    const current = this.row(id)
    if (!current || current.status === 'trashed') return null
    if (changes.targetBoardId && !this.boardExists(changes.targetBoardId)) return null
    const now = Date.now()
    this.db
      .update(items)
      .set({ ...changes, updatedAt: now })
      .where(eq(items.id, id))
      .run()
    this.itemUpdated(id)
    if (changes.status !== undefined || changes.targetBoardId !== undefined) this.inboxChanged()
    const next = this.row(id)
    if (next?.targetBoardId && next.status === 'inbox' && changes.targetBoardId)
      this.announcePending(next.targetBoardId, [id])
    return this.byIds([id])[0] ?? null
  }

  /** Moves an item to the trash (30 days). */
  trash(id: string): boolean {
    const current = this.row(id)
    if (!current || current.status === 'trashed') return false
    this.db
      .update(items)
      .set({
        status: 'trashed',
        statusBeforeTrash: current.status,
        trashedAt: Date.now(),
        updatedAt: Date.now(),
        leaseOwner: null,
        leaseUntil: null,
      })
      .where(eq(items.id, id))
      .run()
    this.inboxChanged()
    this.itemUpdated(id)
    return true
  }

  restore(id: string): boolean {
    const current = this.row(id)
    if (current?.status !== 'trashed') return false
    this.db
      .update(items)
      .set({
        status: current.statusBeforeTrash ?? 'inbox',
        statusBeforeTrash: null,
        trashedAt: null,
        updatedAt: Date.now(),
      })
      .where(eq(items.id, id))
      .run()
    this.inboxChanged()
    this.itemUpdated(id)
    return true
  }

  /** "Undo" after placing (PLAN.md 5.4, step 6): back to the inbox, placements forgotten. */
  unplace(id: string, boardId: string | null): boolean {
    const current = this.row(id)
    if (!current || current.status === 'trashed') return false
    this.db.transaction(() => {
      this.db
        .delete(itemPlacements)
        .where(
          boardId
            ? and(eq(itemPlacements.itemId, id), eq(itemPlacements.boardId, boardId))
            : eq(itemPlacements.itemId, id),
        )
        .run()
      const left = this.db
        .select({ id: itemPlacements.itemId })
        .from(itemPlacements)
        .where(eq(itemPlacements.itemId, id))
        .get()
      if (!left) {
        this.db
          .update(items)
          .set({ status: 'inbox', targetBoardId: null, updatedAt: Date.now() })
          .where(eq(items.id, id))
          .run()
      }
    })
    this.inboxChanged()
    this.itemUpdated(id)
    return true
  }

  // --- placement (PLAN.md 5.4) -----------------------------------------------------------------

  /** Atomic lease: only one client may place an item at a time. */
  claim(itemId: string, owner: string, now = Date.now()): boolean {
    const result = this.db
      .update(items)
      .set({ leaseOwner: owner, leaseUntil: now + 30_000 })
      .where(
        and(
          eq(items.id, itemId),
          inArray(items.status, ['inbox', 'archived']),
          sql`(${items.leaseUntil} IS NULL OR ${items.leaseUntil} < ${now} OR ${items.leaseOwner} = ${owner})`,
        ),
      )
      .run()
    return result.changes === 1
  }

  leaseHolder(itemId: string): string | null {
    return this.row(itemId)?.leaseOwner ?? null
  }

  /** Who placed the item last (for "Wurde gerade von Anna platziert"). */
  lastPlacedBy(itemId: string): string | null {
    return (
      this.db
        .select({ name: users.name })
        .from(itemPlacements)
        .innerJoin(users, eq(users.id, itemPlacements.placedBy))
        .where(eq(itemPlacements.itemId, itemId))
        .orderBy(desc(itemPlacements.placedAt))
        .get()?.name ?? null
    )
  }

  /** Marks an item as placed once its elements are in the board state. */
  markPlaced(itemId: string, boardId: string, elementIds: string[], userId: string, owner: string): boolean {
    const now = Date.now()
    const done = this.db.transaction(() => {
      const current = this.row(itemId)
      if (!current || current.status === 'trashed') return false
      if (current.leaseOwner && current.leaseOwner !== owner && (current.leaseUntil ?? 0) > now) return false
      for (const elementId of elementIds) {
        this.db
          .insert(itemPlacements)
          .values({ itemId, boardId, elementId, placedAt: now, placedBy: userId })
          .onConflictDoNothing()
          .run()
      }
      this.db
        .update(items)
        .set({ status: 'placed', leaseOwner: null, leaseUntil: null, updatedAt: now })
        .where(eq(items.id, itemId))
        .run()
      return true
    })
    if (done) {
      this.inboxChanged()
      this.itemUpdated(itemId)
    }
    return done
  }

  /**
   * Keeps item_placements in line with a saved board (PLAN.md 5.4 "Abgleich"): elements of an item
   * on the board make it "placed"; if all elements of a placed item are gone from every board, it
   * goes to the archive.
   */
  reconcileBoard(boardId: string, elements: Iterable<{ id: string; isDeleted?: boolean; customData?: unknown }>) {
    const present = new Map<string, string[]>()
    for (const element of elements) {
      if (element.isDeleted) continue
      const itemId = (element.customData as { wb?: { itemId?: unknown } } | undefined)?.wb?.itemId
      if (typeof itemId !== 'string') continue
      present.set(itemId, [...(present.get(itemId) ?? []), element.id])
    }
    const now = Date.now()
    const changedItems = new Set<string>()
    this.db.transaction(() => {
      const known = this.db
        .select({ itemId: itemPlacements.itemId, elementId: itemPlacements.elementId })
        .from(itemPlacements)
        .where(eq(itemPlacements.boardId, boardId))
        .all()
      const knownKeys = new Set(known.map((row) => `${row.itemId}:${row.elementId}`))
      // New elements of items (e.g. copies) → record them; inbox/archived items become placed.
      const presentIds = [...present.keys()]
      const existingItems = presentIds.length
        ? this.db.select({ id: items.id, status: items.status }).from(items).where(inArray(items.id, presentIds)).all()
        : []
      for (const item of existingItems) {
        for (const elementId of present.get(item.id) ?? []) {
          if (knownKeys.has(`${item.id}:${elementId}`)) continue
          this.db
            .insert(itemPlacements)
            .values({ itemId: item.id, boardId, elementId, placedAt: now })
            .onConflictDoNothing()
            .run()
        }
        if (item.status === 'inbox' || item.status === 'archived') {
          this.db
            .update(items)
            .set({ status: 'placed', leaseOwner: null, leaseUntil: null, updatedAt: now })
            .where(eq(items.id, item.id))
            .run()
          changedItems.add(item.id)
        }
      }
      // Placements whose elements are gone.
      const removed = known.filter((row) => !present.get(row.itemId)?.includes(row.elementId))
      for (const row of removed) {
        this.db
          .delete(itemPlacements)
          .where(and(eq(itemPlacements.boardId, boardId), eq(itemPlacements.elementId, row.elementId)))
          .run()
      }
      for (const itemId of new Set(removed.map((row) => row.itemId))) {
        const left = this.db
          .select({ id: itemPlacements.itemId })
          .from(itemPlacements)
          .where(eq(itemPlacements.itemId, itemId))
          .get()
        if (left) continue
        const archived = this.db
          .update(items)
          .set({ status: 'archived', updatedAt: now })
          .where(and(eq(items.id, itemId), eq(items.status, 'placed')))
          .run()
        if (archived.changes > 0) changedItems.add(itemId)
      }
    })
    if (changedItems.size > 0) {
      this.inboxChanged()
      for (const id of changedItems) this.itemUpdated(id)
    }
  }

  // --- processing results ---------------------------------------------------------------------

  setProcessed(itemId: string, changes: { meta?: ItemMeta; title?: string | null; note?: string | null }) {
    const current = this.row(itemId)
    if (!current) return
    const meta = { ...(JSON.parse(current.metaJson) as ItemMeta), ...changes.meta }
    this.db
      .update(items)
      .set({
        metaJson: JSON.stringify(meta),
        processing: 'ready',
        processingError: null,
        updatedAt: Date.now(),
        ...(changes.title !== undefined ? { title: changes.title } : {}),
        ...(changes.note !== undefined ? { note: changes.note } : {}),
      })
      .where(eq(items.id, itemId))
      .run()
    this.itemUpdated(itemId)
    this.inboxChanged()
    // Images can only be placed automatically once their display version exists.
    if (current.targetBoardId && current.status === 'inbox') this.announcePending(current.targetBoardId, [itemId])
  }

  setFailed(itemId: string, error: string) {
    this.db
      .update(items)
      .set({ processing: 'failed', processingError: error.slice(0, 500), updatedAt: Date.now() })
      .where(eq(items.id, itemId))
      .run()
    this.itemUpdated(itemId)
    this.inboxChanged()
  }

  setText(itemId: string, kind: 'pdf' | 'doc' | 'article' | 'ocr', text: string) {
    this.db
      .insert(itemTexts)
      .values({ itemId, kind, text, createdAt: Date.now() })
      .onConflictDoUpdate({ target: [itemTexts.itemId, itemTexts.kind], set: { text, createdAt: Date.now() } })
      .run()
    this.reindex(itemId)
  }

  /** Deletes items that have been in the trash for 30 days, including their files. */
  purgeTrash(now = Date.now()): number {
    const old = this.db
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.status, 'trashed'),
          isNotNull(items.trashedAt),
          lt(items.trashedAt, now - ITEM_TRASH_RETENTION_MS),
        ),
      )
      .all()
    for (const { id } of old) {
      for (const asset of this.db.select({ path: assets.path }).from(assets).where(eq(assets.itemId, id)).all()) {
        fs.rmSync(path.join(this.filesDir, asset.path), { force: true })
      }
      const dir = this.db.select({ createdAt: items.createdAt }).from(items).where(eq(items.id, id)).get()
      if (dir) fs.rmSync(path.join(this.filesDir, this.assetDir(id, dir.createdAt)), { recursive: true, force: true })
      this.db.delete(assets).where(eq(assets.itemId, id)).run()
      this.db.delete(items).where(eq(items.id, id)).run()
      this.onRemoved?.(id)
    }
    return old.length
  }

  /** Asset row for /api/assets/:id; board images (board_file) are served via /api/files. */
  asset(assetId: string) {
    return this.db
      .select()
      .from(assets)
      .where(and(eq(assets.id, assetId), ne(assets.role, 'board_file')))
      .get()
  }
}
