import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ulid } from '@wb/shared'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { AppContext } from '../context.ts'
import { assets, boards } from '../db/schema.ts'
import { sendError } from '../lib/http.ts'
import { RateLimiter } from '../lib/rateLimit.ts'
import { sniffBoardImage } from './sniff.ts'

// Excalidraw file ids are SHA-1 hashes (40 hex chars); allow a little more for safety.
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/

/** Headers for serving uploaded content (PLAN.md 8.3). */
export function setUploadHeaders(reply: FastifyReply, mime: string, filename: string, download = false) {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('Content-Security-Policy', "sandbox; default-src 'none'")
  reply.type(mime)
  // SVG, HTML, XML and scripts are never shown inline.
  const inline =
    !download && /^(image\/(png|jpeg|gif|webp|bmp|avif|x-icon)|application\/pdf|audio\/|video\/)/.test(mime)
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  reply.header(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  )
}

/** Board images (PLAN.md 5.3): upload once per Excalidraw fileId, fetch on demand. */
export function registerFileRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx.database
  const filesDir = path.join(ctx.config.DATA_DIR, 'files')
  const tmpDir = path.join(ctx.config.DATA_DIR, 'tmp')
  const uploadLimiter = new RateLimiter(300, 15 * 60 * 1000)

  app.post<{ Params: { id: string } }>('/api/boards/:id/files', async (request, reply) => {
    const { user } = request.auth ?? {}
    if (!user || !uploadLimiter.take(user.id)) return sendError(reply, 429, 'too_many_requests')
    const board = db
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.id, request.params.id), isNull(boards.deletedAt)))
      .get()
    if (!board) return sendError(reply, 404, 'not_found')
    if (!request.isMultipart()) return sendError(reply, 400, 'invalid')

    let fileId: string | undefined
    let data: Buffer | undefined
    for await (const part of request.parts()) {
      if (part.type === 'field' && part.fieldname === 'fileId' && typeof part.value === 'string') {
        fileId = part.value
      } else if (part.type === 'file' && part.fieldname === 'file' && !data) {
        data = await part.toBuffer()
      } else if (part.type === 'file') {
        part.file.resume()
      }
    }
    if (!fileId || !FILE_ID_PATTERN.test(fileId) || !data) return sendError(reply, 400, 'invalid')
    const mime = sniffBoardImage(data)
    if (!mime) return sendError(reply, 415, 'unsupported_type')

    if (db.select({ id: assets.id }).from(assets).where(eq(assets.id, fileId)).get()) {
      return reply.code(200).send({ fileId })
    }
    const relative = path.posix.join('board', fileId)
    const target = path.join(filesDir, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmp = path.join(tmpDir, `${ulid()}.upload`)
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, target)
    db.insert(assets)
      .values({
        id: fileId,
        boardId: board.id,
        role: 'board_file',
        mime,
        size: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
        path: relative,
        createdAt: Date.now(),
      })
      .onConflictDoNothing()
      .run()
    return reply.code(201).send({ fileId })
  })

  app.get<{ Params: { fileId: string } }>('/api/files/:fileId', async (request, reply) => {
    if (!FILE_ID_PATTERN.test(request.params.fileId)) return sendError(reply, 404, 'not_found')
    const asset = db
      .select({ mime: assets.mime, path: assets.path, size: assets.size })
      .from(assets)
      // Excalidraw uploads and display versions of inbox images placed on a board.
      .where(and(eq(assets.id, request.params.fileId), inArray(assets.role, ['board_file', 'display'])))
      .get()
    if (!asset) return sendError(reply, 404, 'not_found')
    const file = path.join(filesDir, asset.path)
    if (!fs.existsSync(file)) return sendError(reply, 404, 'not_found')
    // Content never changes under the same id (Excalidraw derives it from the content).
    reply.header('Cache-Control', 'private, max-age=31536000, immutable')
    setUploadHeaders(reply, asset.mime, request.params.fileId)
    reply.header('Content-Length', asset.size)
    return reply.send(fs.createReadStream(file))
  })
}
