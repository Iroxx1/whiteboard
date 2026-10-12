import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { type IngestResult, ulid } from '@wb/shared'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { authOf } from '../auth/hook.ts'
import type { AppContext } from '../context.ts'
import { shareRequests } from '../db/schema.ts'
import type { IngestFile } from '../ingest/normalize.ts'
import { resolveHashtags } from '../lib/hashtags.ts'
import { noStore, parseBody, sendError } from '../lib/http.ts'
import { sanitizeFilename } from '../lib/mime.ts'
import { RateLimiter } from '../lib/rateLimit.ts'
import { findUrls, parseHttpUrl, stripUrls } from '../lib/urls.ts'
import { IngestError } from './service.ts'

const CLIENT_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/
const MAX_FILES = 50

const shareSchema = z.object({
  clientShareId: z.string().regex(CLIENT_ID),
  title: z.string().max(1000).optional(),
  text: z.string().max(20_000).optional(),
  url: z.string().max(4000).optional(),
  fileCount: z.number().int().min(0).max(MAX_FILES).default(0),
})

type Steps = Record<string, string[]>

/**
 * PWA uploads (PLAN.md 5.6): first title/text/URL with a client-generated `clientShareId`, then each
 * file in its own request (stays below Cloudflare's 100 MB per request). Every step is idempotent,
 * so the service worker can simply retry after a lost connection.
 */
export function registerShareRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx.database
  const { items } = ctx
  const tmpDir = path.join(ctx.config.DATA_DIR, 'tmp')
  const limiter = new RateLimiter(300, 15 * 60 * 1000)

  const load = (clientShareId: string, userId: string) =>
    db
      .select()
      .from(shareRequests)
      .where(and(eq(shareRequests.clientShareId, clientShareId), eq(shareRequests.userId, userId)))
      .get()

  const saveStep = (clientShareId: string, step: string, ids: string[]) => {
    const row = db
      .select({ itemIds: shareRequests.itemIds })
      .from(shareRequests)
      .where(eq(shareRequests.clientShareId, clientShareId))
      .get()
    const steps = JSON.parse(row?.itemIds ?? '{}') as Steps
    steps[step] = ids
    db.update(shareRequests)
      .set({ itemIds: JSON.stringify(steps) })
      .where(eq(shareRequests.clientShareId, clientShareId))
      .run()
  }

  const allIds = (itemIds: string) => [...new Set(Object.values(JSON.parse(itemIds) as Steps).flat())]

  // The page and the service worker (background sync) may upload the same share at the same time;
  // steps of one share run one after another so nothing is created twice.
  const locks = new Map<string, Promise<unknown>>()
  const serialized = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const next = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(run)
    locks.set(key, next)
    void next
      .finally(() => {
        if (locks.get(key) === next) locks.delete(key)
      })
      .catch(() => undefined)
    return next
  }

  app.post('/api/items/share', async (request, reply) => {
    noStore(reply)
    const { user } = authOf(request)
    if (!limiter.take(user.id)) return sendError(reply, 429, 'too_many_requests')
    const body = parseBody(shareSchema, request.body, reply)
    if (!body) return reply
    return serialized(body.clientShareId, async () => {
      const existing = load(body.clientShareId, user.id)
      if (existing) return { items: items.byIds(allIds(existing.itemIds)), duplicateIds: [] } satisfies IngestResult
      if (
        db
          .select({ id: shareRequests.clientShareId })
          .from(shareRequests)
          .where(eq(shareRequests.clientShareId, body.clientShareId))
          .get()
      ) {
        return sendError(reply, 409, 'invalid')
      }

      // Hashtags pick the board for all items of the share; with files the text becomes the note of
      // the first file (PLAN.md 5.5), so only its links become items now.
      const boards = items.boardsByHashtag()
      const tags = resolveHashtags(`${body.title ?? ''}\n${body.text ?? ''}`, boards)
      const urls = [
        ...(body.url && parseHttpUrl(body.url.trim()) ? [new URL(body.url.trim()).href] : []),
        ...findUrls(body.text ?? ''),
      ]
      const note = stripUrls(resolveHashtags(body.text ?? '', boards).text, urls) || null
      const groupId = ulid()
      db.insert(shareRequests)
        .values({
          clientShareId: body.clientShareId,
          userId: user.id,
          groupId,
          note,
          // With links the shared title belongs to them (Android: page title + URL); otherwise to a single file.
          title: urls.length === 0 ? body.title?.trim() || null : null,
          targetBoardId: tags.boardId,
          fileCount: body.fileCount,
          createdAt: Date.now(),
        })
        .run()

      let result: IngestResult = { items: [], duplicateIds: [] }
      const textPayload =
        body.fileCount > 0
          ? { url: body.url, text: urls.join('\n') || undefined, title: urls.length === 1 ? body.title : undefined }
          : { title: body.title, text: body.text, url: body.url }
      if (textPayload.text || textPayload.url || (body.fileCount === 0 && textPayload.title)) {
        try {
          result = await items.ingest(
            { userId: user.id, source: 'pwa', files: [], targetBoardId: tags.boardId, ...textPayload },
            { groupId },
          )
        } catch (error) {
          if (!(error instanceof IngestError)) throw error
        }
      }
      saveStep(
        body.clientShareId,
        'text',
        result.items.map((item) => item.id),
      )
      return reply.code(201).send(result)
    })
  })

  app.post<{ Params: { clientShareId: string } }>('/api/items/share/:clientShareId/files', async (request, reply) => {
    noStore(reply)
    const { user } = authOf(request)
    if (!limiter.take(user.id)) return sendError(reply, 429, 'too_many_requests')
    const share = CLIENT_ID.test(request.params.clientShareId) ? load(request.params.clientShareId, user.id) : undefined
    if (!share) return sendError(reply, 404, 'not_found')
    if (!request.isMultipart()) return sendError(reply, 400, 'invalid')

    let index: number | null = null
    let file: IngestFile | null = null
    try {
      for await (const part of request.parts()) {
        if (part.type === 'field') {
          if (part.fieldname === 'index') index = Number(part.value)
          continue
        }
        if (file) {
          part.file.resume()
          continue
        }
        const tmpPath = path.join(tmpDir, `${ulid()}.upload`)
        await pipeline(part.file, fs.createWriteStream(tmpPath))
        file = {
          filename: sanitizeFilename(part.filename || 'datei'),
          mime: part.mimetype,
          size: fs.statSync(tmpPath).size,
          tmpPath,
        }
        if (part.file.truncated) {
          fs.rmSync(tmpPath, { force: true })
          return sendError(reply, 413, 'file_too_large')
        }
      }
    } catch (error) {
      if (file) fs.rmSync(file.tmpPath, { force: true })
      const tooLarge = error instanceof Error && error.name === 'RequestFileTooLargeError'
      return tooLarge ? sendError(reply, 413, 'file_too_large') : sendError(reply, 400, 'invalid')
    }
    if (!file || index === null || !Number.isInteger(index) || index < 0 || index >= Math.max(share.fileCount, 1)) {
      if (file) fs.rmSync(file.tmpPath, { force: true })
      return sendError(reply, 400, 'invalid')
    }

    const upload = file
    const position = index
    return serialized(share.clientShareId, async () => {
      // Repeated upload of the same file (retry after a lost response): return what exists.
      const steps = JSON.parse(load(share.clientShareId, user.id)?.itemIds ?? '{}') as Steps
      const done = steps[String(position)]
      if (done) {
        fs.rmSync(upload.tmpPath, { force: true })
        return { items: items.byIds(done), duplicateIds: [] } satisfies IngestResult
      }
      const first = position === 0
      const result = await items.ingest(
        {
          userId: user.id,
          source: 'pwa',
          files: [upload],
          title: first && share.fileCount === 1 ? (share.title ?? undefined) : undefined,
          text: first ? (share.note ?? undefined) : undefined,
          targetBoardId: share.targetBoardId,
        },
        { groupId: share.groupId },
      )
      saveStep(
        share.clientShareId,
        String(position),
        result.items.map((item) => item.id),
      )
      return reply.code(201).send(result)
    })
  })

  /**
   * Fallback when the service worker did not catch the share (PLAN.md 5.6): with a session the
   * upload is processed at once; without one, a short hint. `Sec-Fetch-Site: none` is allowed for
   * this route by the origin guard (started by the operating system).
   */
  app.post('/share-target', async (request: FastifyRequest, reply: FastifyReply) => {
    noStore(reply)
    if (!request.auth) {
      return reply
        .code(401)
        .type('text/html; charset=utf-8')
        .send(
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
            '<title>Anmeldung nötig</title><p style="font-family:sans-serif;padding:1rem">' +
            'Bitte die App einmal öffnen, anmelden und dann erneut teilen.</p>',
        )
    }
    if (!request.isMultipart()) return sendError(reply, 415, 'invalid')
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
      const result = await items.ingest({
        userId: request.auth.user.id,
        source: 'pwa',
        title: fields.title,
        text: fields.text,
        url: fields.url,
        files,
      })
      return reply.redirect(`/share?done=${result.items.map((item) => item.id).join(',')}`, 303)
    } catch (error) {
      for (const file of files) fs.rmSync(file.tmpPath, { force: true })
      if (error instanceof IngestError) return reply.redirect('/share?empty=1', 303)
      throw error
    }
  })
}
