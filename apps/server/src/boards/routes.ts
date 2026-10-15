import fs from 'node:fs'
import path from 'node:path'
import {
  BOARD_TAG_MAX_LENGTH,
  BOARD_TAGS_MAX,
  type BoardDetail,
  type BoardSummary,
  EVENTS,
  HASHTAG_PATTERN,
  normalizeHashtag,
  normalizeTags,
  type SnapshotInfo,
  ulid,
} from '@wb/shared'
import { and, desc, eq, isNotNull, isNull, lt } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { FastifyInstance, FastifyReply } from 'fastify'
import sharp from 'sharp'
import { z } from 'zod'
import { authOf } from '../auth/hook.ts'
import type { AppContext } from '../context.ts'
import type { Db } from '../db/index.ts'
import { boardSnapshots, boards, users } from '../db/schema.ts'
import { setUploadHeaders } from '../files/routes.ts'
import { noStore, parseBody, sendError } from '../lib/http.ts'
import { RateLimiter } from '../lib/rateLimit.ts'
import { referencedFileIds } from './elements.ts'

/** Boards in the trash are deleted for good after this time (PLAN.md 4.6). */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** Preview images: upload limit and stored size (about 4:3, fits the dashboard tiles). */
const THUMB_UPLOAD_MAX = 3 * 1024 * 1024
const THUMB_WIDTH = 640
const THUMB_HEIGHT = 480

const boardNameSchema = z.string().trim().min(1).max(80)
const hashtagInput = z.string().max(80)
const tagsSchema = z.array(z.string().max(BOARD_TAG_MAX_LENGTH + 8)).max(BOARD_TAGS_MAX + 10)
const createSchema = z.object({ name: boardNameSchema, hashtag: hashtagInput.optional(), tags: tagsSchema.optional() })
const patchSchema = z
  .object({ name: boardNameSchema.optional(), hashtag: hashtagInput.optional(), tags: tagsSchema.optional() })
  .refine((value) => value.name !== undefined || value.hashtag !== undefined || value.tags !== undefined)

const updater = alias(users, 'updater')
const author = alias(users, 'author')

type SummaryRow = Omit<BoardSummary, 'tags'> & { tagsJson: string }

function toSummary({ tagsJson, ...row }: SummaryRow): BoardSummary {
  return { ...row, tags: JSON.parse(tagsJson) as string[] }
}

function summaries(db: Db, trash: boolean): BoardSummary[] {
  return db
    .select({
      id: boards.id,
      name: boards.name,
      hashtag: boards.hashtag,
      createdAt: boards.createdAt,
      updatedAt: boards.updatedAt,
      updatedByName: updater.name,
      deletedAt: boards.deletedAt,
      tagsJson: boards.tagsJson,
      thumbAt: boards.thumbAt,
    })
    .from(boards)
    .leftJoin(updater, eq(updater.id, boards.updatedBy))
    .where(trash ? isNotNull(boards.deletedAt) : isNull(boards.deletedAt))
    .orderBy(desc(trash ? boards.deletedAt : boards.updatedAt))
    .all()
    .map(toSummary)
}

function summary(db: Db, id: string): BoardSummary | undefined {
  const row = db
    .select({
      id: boards.id,
      name: boards.name,
      hashtag: boards.hashtag,
      createdAt: boards.createdAt,
      updatedAt: boards.updatedAt,
      updatedByName: updater.name,
      deletedAt: boards.deletedAt,
      tagsJson: boards.tagsJson,
      thumbAt: boards.thumbAt,
    })
    .from(boards)
    .leftJoin(updater, eq(updater.id, boards.updatedBy))
    .where(eq(boards.id, id))
    .get()
  return row && toSummary(row)
}

/** Normalises a hashtag; sends 400 and returns null if nothing usable is left. */
function validHashtag(input: string, reply: FastifyReply): string | null {
  const hashtag = normalizeHashtag(input)
  if (HASHTAG_PATTERN.test(hashtag)) return hashtag
  sendError(reply, 400, 'invalid', { fields: ['hashtag'] })
  return null
}

function isUniqueViolation(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE'
}

/** Deletes boards that have been in the trash for more than 30 days (snapshots cascade). */
export function purgeTrash(db: Db, now = Date.now()): number {
  return db
    .delete(boards)
    .where(and(isNotNull(boards.deletedAt), lt(boards.deletedAt, now - TRASH_RETENTION_MS)))
    .run().changes
}

/** Boards, trash and history (PLAN.md 4.6, 6). Everyone can see and edit every board. */
export function registerBoardRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx.database
  const changed = (boardId: string, extra: object = {}) => {
    // Name and hashtag are searchable; deleted boards are filtered out when searching (PLAN.md 5.9).
    ctx.search.indexBoard(boardId)
    ctx.hub.toAll(EVENTS.boardsChanged, { boardId, ...extra })
  }

  app.get<{ Querystring: { trash?: string } }>('/api/boards', async (request, reply) => {
    noStore(reply)
    return summaries(db, request.query.trash === '1')
  })

  app.post('/api/boards', async (request, reply) => {
    noStore(reply)
    const body = parseBody(createSchema, request.body, reply)
    if (!body) return reply
    const hashtag = validHashtag(body.hashtag ?? body.name, reply)
    if (!hashtag) return reply
    const { user } = authOf(request)
    const now = Date.now()
    const id = ulid(now)
    try {
      db.insert(boards)
        .values({
          id,
          name: body.name,
          hashtag,
          createdBy: user.id,
          createdAt: now,
          updatedAt: now,
          updatedBy: user.id,
          tagsJson: JSON.stringify(normalizeTags(body.tags ?? [])),
        })
        .run()
    } catch (error) {
      if (isUniqueViolation(error)) return sendError(reply, 409, 'hashtag_taken')
      throw error
    }
    changed(id)
    return reply.code(201).send(summary(db, id))
  })

  app.get<{ Params: { id: string } }>('/api/boards/:id', async (request, reply) => {
    noStore(reply)
    const meta = summary(db, request.params.id)
    const state = meta && !meta.deletedAt ? ctx.rooms.state(meta.id) : null
    if (!meta || !state) return sendError(reply, 404, 'not_found')
    return { ...meta, ...state, fileIds: referencedFileIds(state.elements) } satisfies BoardDetail
  })

  app.patch<{ Params: { id: string } }>('/api/boards/:id', async (request, reply) => {
    noStore(reply)
    const body = parseBody(patchSchema, request.body, reply)
    if (!body) return reply
    const hashtag = body.hashtag === undefined ? undefined : validHashtag(body.hashtag, reply)
    if (hashtag === null) return reply
    try {
      const result = db
        .update(boards)
        .set({
          ...(body.name ? { name: body.name } : {}),
          ...(hashtag ? { hashtag } : {}),
          ...(body.tags ? { tagsJson: JSON.stringify(normalizeTags(body.tags)) } : {}),
        })
        .where(eq(boards.id, request.params.id))
        .run()
      if (result.changes === 0) return sendError(reply, 404, 'not_found')
    } catch (error) {
      if (isUniqueViolation(error)) return sendError(reply, 409, 'hashtag_taken')
      throw error
    }
    changed(request.params.id)
    return summary(db, request.params.id)
  })

  // Moves the board to the trash; it can be restored for 30 days.
  app.delete<{ Params: { id: string } }>('/api/boards/:id', async (request, reply) => {
    noStore(reply)
    ctx.rooms.evict(request.params.id)
    const result = db
      .update(boards)
      .set({ deletedAt: Date.now() })
      .where(and(eq(boards.id, request.params.id), isNull(boards.deletedAt)))
      .run()
    if (result.changes === 0) return sendError(reply, 404, 'not_found')
    changed(request.params.id, { deleted: true })
    return reply.code(204).send()
  })

  app.post<{ Params: { id: string } }>('/api/boards/:id/restore', async (request, reply) => {
    noStore(reply)
    const result = db
      .update(boards)
      .set({ deletedAt: null })
      .where(and(eq(boards.id, request.params.id), isNotNull(boards.deletedAt)))
      .run()
    if (result.changes === 0) return sendError(reply, 404, 'not_found')
    changed(request.params.id)
    return summary(db, request.params.id)
  })

  // Preview image for the dashboard (Phase 10). The browser renders it (board elements are only ever
  // created and drawn client-side); the upload is re-encoded here, so whatever arrives is a small WebP.
  const thumbsDir = path.join(ctx.config.DATA_DIR, 'thumbs')
  const thumbLimiter = new RateLimiter(120, 15 * 60 * 1000)

  app.put<{ Params: { id: string } }>('/api/boards/:id/thumbnail', async (request, reply) => {
    noStore(reply)
    const { user } = authOf(request)
    if (!thumbLimiter.take(user.id)) return sendError(reply, 429, 'too_many_requests')
    const board = db
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.id, request.params.id), isNull(boards.deletedAt)))
      .get()
    if (!board) return sendError(reply, 404, 'not_found')
    if (!request.isMultipart()) return sendError(reply, 400, 'invalid')
    const upload = await request.file({ limits: { fileSize: THUMB_UPLOAD_MAX, files: 1 } })
    if (!upload) return sendError(reply, 400, 'invalid')
    const input = await upload.toBuffer()
    if (upload.file.truncated) return sendError(reply, 400, 'invalid')
    let output: Buffer
    try {
      output = await sharp(input, { failOn: 'none', limitInputPixels: 40_000_000 })
        .resize({ width: THUMB_WIDTH, height: THUMB_HEIGHT, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .webp({ quality: 78 })
        .toBuffer()
    } catch {
      return sendError(reply, 400, 'invalid')
    }
    fs.mkdirSync(thumbsDir, { recursive: true })
    const target = path.join(thumbsDir, `${board.id}.webp`)
    fs.writeFileSync(`${target}.tmp`, output)
    fs.renameSync(`${target}.tmp`, target)
    const thumbAt = Date.now()
    db.update(boards).set({ thumbAt }).where(eq(boards.id, board.id)).run()
    // Only dashboards need to know; the board's "last changed" stays untouched.
    ctx.hub.toAll(EVENTS.boardsChanged, { boardId: board.id })
    return { thumbAt }
  })

  app.get<{ Params: { id: string } }>('/api/boards/:id/thumbnail', async (request, reply) => {
    const file = path.join(thumbsDir, `${path.basename(request.params.id)}.webp`)
    if (!fs.existsSync(file)) return sendError(reply, 404, 'not_found')
    reply.header('Cache-Control', 'private, max-age=31536000, immutable')
    setUploadHeaders(reply, 'image/webp', 'preview.webp')
    return reply.send(fs.createReadStream(file))
  })

  app.get<{ Params: { id: string } }>('/api/boards/:id/snapshots', async (request, reply) => {
    noStore(reply)
    const exists = db.select({ id: boards.id }).from(boards).where(eq(boards.id, request.params.id)).get()
    if (!exists) return sendError(reply, 404, 'not_found')
    return db
      .select({
        id: boardSnapshots.id,
        createdAt: boardSnapshots.createdAt,
        createdByName: author.name,
        reason: boardSnapshots.reason,
        elementCount: boardSnapshots.elementCount,
      })
      .from(boardSnapshots)
      .leftJoin(author, eq(author.id, boardSnapshots.createdBy))
      .where(eq(boardSnapshots.boardId, request.params.id))
      .orderBy(desc(boardSnapshots.createdAt))
      .all() satisfies SnapshotInfo[]
  })

  app.post<{ Params: { id: string } }>('/api/boards/:id/snapshots', async (request, reply) => {
    noStore(reply)
    const { user } = authOf(request)
    const info = ctx.rooms.createSnapshot(request.params.id, user.id, 'manual')
    if (!info) return sendError(reply, 404, 'not_found')
    return reply.code(201).send({ ...info, createdByName: user.name } satisfies SnapshotInfo)
  })

  app.post<{ Params: { id: string; sid: string } }>(
    '/api/boards/:id/snapshots/:sid/restore',
    async (request, reply) => {
      noStore(reply)
      const ok = ctx.rooms.restore(request.params.id, request.params.sid, authOf(request).user.id)
      if (!ok) return sendError(reply, 404, 'not_found')
      return reply.code(204).send()
    },
  )
}
