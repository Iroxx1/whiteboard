import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { ITEM_KINDS, type ItemKind, type ItemList, ulid } from '@wb/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authOf } from '../auth/hook.ts'
import type { AppContext } from '../context.ts'
import { setUploadHeaders } from '../files/routes.ts'
import type { IngestFile } from '../ingest/normalize.ts'
import { noStore, parseBody, sendError } from '../lib/http.ts'
import { sanitizeFilename } from '../lib/mime.ts'
import { RateLimiter } from '../lib/rateLimit.ts'
import { IngestError } from './service.ts'

const ID = /^[0-9A-HJKMNP-TV-Z]{26}$/

const listQuery = z.object({
  status: z.enum(['inbox', 'archived', 'trashed', 'placed']).default('inbox'),
  kind: z.string().max(100).optional(),
  ids: z
    .string()
    .max(27 * 200)
    .optional(),
  cursor: z.string().regex(ID).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

const createSchema = z.object({
  title: z.string().max(1000).optional(),
  text: z.string().max(20_000).optional(),
  url: z.string().max(4000).optional(),
  targetBoardId: z.string().regex(ID).nullable().optional(),
})

const patchSchema = z
  .object({
    title: z.string().trim().max(300).nullable().optional(),
    note: z.string().max(10_000).nullable().optional(),
    targetBoardId: z.string().regex(ID).nullable().optional(),
    status: z.enum(['inbox', 'archived']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0)

/** Reads a multipart upload: fields plus files streamed into /data/tmp (PLAN.md 5.5 limits). */
async function readMultipart(request: FastifyRequest, tmpDir: string) {
  const fields: Record<string, string> = {}
  const files: IngestFile[] = []
  try {
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (typeof part.value === 'string') fields[part.fieldname] = part.value
        continue
      }
      const tmpPath = path.join(tmpDir, `${ulid()}.upload`)
      await pipeline(part.file, fs.createWriteStream(tmpPath))
      if (part.file.truncated) throw new Error('file_too_large')
      files.push({
        filename: sanitizeFilename(part.filename || 'datei'),
        mime: part.mimetype,
        size: fs.statSync(tmpPath).size,
        tmpPath,
      })
    }
  } catch (error) {
    for (const file of files) fs.rmSync(file.tmpPath, { force: true })
    throw error
  }
  return { fields, files }
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return 'invalid'
  const [, from, to] = match
  let start: number
  let end: number
  if (from === '') {
    const suffix = Number(to)
    if (!suffix) return 'invalid'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(from)
    end = to === '' ? size - 1 : Math.min(Number(to), size - 1)
  }
  return start > end || start >= size ? 'invalid' : { start, end }
}

/** Inbox items (PLAN.md 6): list, add via web, edit, trash, undo placement, serve files. */
export function registerItemRoutes(app: FastifyInstance, ctx: AppContext) {
  const { items } = ctx
  const tmpDir = path.join(ctx.config.DATA_DIR, 'tmp')
  const uploadLimiter = new RateLimiter(120, 15 * 60 * 1000)

  const notFound = (reply: FastifyReply) => sendError(reply, 404, 'not_found')

  app.get('/api/items', async (request, reply): Promise<ItemList | undefined> => {
    noStore(reply)
    const query = parseBody(listQuery, request.query, reply)
    if (!query) return
    if (query.ids) {
      const ids = query.ids.split(',').filter((id) => ID.test(id))
      return { items: items.byIds(ids), nextCursor: null }
    }
    const kinds = query.kind
      ? (query.kind.split(',').filter((kind) => (ITEM_KINDS as readonly string[]).includes(kind)) as ItemKind[])
      : null
    return items.list(query.status, kinds, query.cursor ?? null, query.limit)
  })

  app.post('/api/items', async (request, reply) => {
    noStore(reply)
    const { user } = authOf(request)
    if (!uploadLimiter.take(user.id)) return sendError(reply, 429, 'too_many_requests')
    let fields: Record<string, unknown> = (request.body as Record<string, unknown> | undefined) ?? {}
    let files: IngestFile[] = []
    if (request.isMultipart()) {
      try {
        ;({ fields, files } = await readMultipart(request, tmpDir))
      } catch (error) {
        const tooLarge =
          error instanceof Error && (error.message === 'file_too_large' || error.name === 'RequestFileTooLargeError')
        return tooLarge ? sendError(reply, 413, 'file_too_large') : sendError(reply, 400, 'invalid')
      }
    }
    const body = parseBody(createSchema, fields, reply)
    if (!body) {
      for (const file of files) fs.rmSync(file.tmpPath, { force: true })
      return reply
    }
    try {
      const result = await items.ingest({
        userId: user.id,
        source: 'web',
        title: body.title,
        text: body.text,
        url: body.url,
        files,
        targetBoardId: body.targetBoardId ?? null,
      })
      return reply.code(201).send(result)
    } catch (error) {
      for (const file of files) fs.rmSync(file.tmpPath, { force: true })
      if (error instanceof IngestError) return sendError(reply, 400, 'invalid')
      throw error
    }
  })

  app.get<{ Params: { id: string } }>('/api/items/:id', async (request, reply) => {
    noStore(reply)
    return items.detail(request.params.id) ?? notFound(reply)
  })

  app.patch<{ Params: { id: string } }>('/api/items/:id', async (request, reply) => {
    noStore(reply)
    const body = parseBody(patchSchema, request.body, reply)
    if (!body) return reply
    const updated = items.update(request.params.id, {
      ...body,
      ...(body.title !== undefined ? { title: body.title || null } : {}),
      ...(body.note !== undefined ? { note: body.note?.trim() || null } : {}),
    })
    return updated ?? notFound(reply)
  })

  app.delete<{ Params: { id: string } }>('/api/items/:id', async (request, reply) => {
    noStore(reply)
    return items.trash(request.params.id) ? reply.code(204).send() : notFound(reply)
  })

  app.post<{ Params: { id: string } }>('/api/items/:id/restore', async (request, reply) => {
    noStore(reply)
    return items.restore(request.params.id) ? reply.code(204).send() : notFound(reply)
  })

  app.post<{ Params: { id: string } }>('/api/items/:id/unplace', async (request, reply) => {
    noStore(reply)
    const body = parseBody(z.object({ boardId: z.string().regex(ID).optional() }), request.body ?? {}, reply)
    if (!body) return reply
    return items.unplace(request.params.id, body.boardId ?? null) ? reply.code(204).send() : notFound(reply)
  })

  // Uploaded files with the safety headers from PLAN.md 8.3; Range support for audio/video seeking.
  app.get<{ Params: { assetId: string }; Querystring: { download?: string } }>(
    '/api/assets/:assetId',
    async (request, reply) => {
      if (!ID.test(request.params.assetId)) return notFound(reply)
      const asset = items.asset(request.params.assetId)
      if (!asset) return notFound(reply)
      const file = path.join(items.filesDir, asset.path)
      if (!fs.existsSync(file)) return notFound(reply)
      const item = asset.itemId ? items.row(asset.itemId) : undefined
      const meta = item ? (JSON.parse(item.metaJson) as { filename?: string }) : {}
      const name =
        asset.role === 'original' && meta.filename
          ? meta.filename
          : path.posix.basename(asset.path).replace(/^[a-z_0-9]+-/, '')
      reply.header('Cache-Control', 'private, max-age=31536000, immutable')
      reply.header('Accept-Ranges', 'bytes')
      setUploadHeaders(reply, asset.mime, name, request.query.download === '1')

      const range = parseRange(request.headers.range, asset.size)
      if (range === 'invalid') return reply.code(416).header('Content-Range', `bytes */${asset.size}`).send()
      if (range) {
        reply.code(206)
        reply.header('Content-Range', `bytes ${range.start}-${range.end}/${asset.size}`)
        reply.header('Content-Length', range.end - range.start + 1)
        return reply.send(fs.createReadStream(file, { start: range.start, end: range.end }))
      }
      reply.header('Content-Length', asset.size)
      return reply.send(fs.createReadStream(file))
    },
  )
}
