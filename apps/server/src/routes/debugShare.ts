import type { SharedFileInfo, ShareReport } from '@wb/shared'
import { ulid } from '@wb/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

// Spike A test page, kept until Phase 3 replaces it with the real share flow (only for signed-in
// users since Phase 1). Records what the Android share sheet delivers. Files are counted and
// discarded, nothing is written to disk, and reports live in memory only (never logged).

const MAX_REPORTS = 50
const MAX_TEXT = 4000

const clip = (value: string | undefined) => (value ? value.slice(0, MAX_TEXT) : null)

export function registerDebugShareRoutes(app: FastifyInstance) {
  const reports: ShareReport[] = []

  async function readShare(request: FastifyRequest, defaultVia: ShareReport['via']): Promise<ShareReport> {
    const fields: Record<string, string> = {}
    const files: SharedFileInfo[] = []
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        let size = 0
        for await (const chunk of part.file) size += (chunk as Buffer).length
        files.push({ name: part.filename, type: part.mimetype, size })
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value
      }
    }
    const report: ShareReport = {
      id: ulid(),
      receivedAt: new Date().toISOString(),
      via: fields.via === 'service-worker' ? 'service-worker' : defaultVia,
      title: clip(fields.title),
      text: clip(fields.text),
      url: clip(fields.url),
      files,
      userAgent: clip(request.headers['user-agent']),
    }
    reports.unshift(report)
    reports.length = Math.min(reports.length, MAX_REPORTS)
    request.log.info({ reportId: report.id, via: report.via, fileCount: files.length }, 'share report received')
    return report
  }

  const noStore = (reply: FastifyReply) => reply.header('Cache-Control', 'no-store')

  app.post('/api/debug/share', async (request, reply) => {
    noStore(reply)
    if (!request.isMultipart()) return reply.code(415).send({ error: 'multipart expected' })
    return readShare(request, 'service-worker')
  })

  app.get('/api/debug/share', async (_request, reply) => {
    noStore(reply)
    return { reports }
  })

  app.get<{ Params: { id: string } }>('/api/debug/share/:id', async (request, reply) => {
    noStore(reply)
    const report = reports.find((entry) => entry.id === request.params.id)
    return report ?? reply.code(404).send({ error: 'not found' })
  })

  // Normally intercepted by the service worker; this fallback handles shares that reach the
  // server directly, e.g. before the service worker is active (PLAN.md 5.6).
  app.post('/share-target', async (request, reply) => {
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
    if (!request.isMultipart()) return reply.code(415).send({ error: 'multipart expected' })
    const report = await readShare(request, 'server-fallback')
    return reply.redirect(`/share?report=${report.id}`, 303)
  })
}
