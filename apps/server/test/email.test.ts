import { generateKeyPairSync } from 'node:crypto'
import type { EmailSettings, Item } from '@wb/shared'
import { dkimSign } from 'mailauth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanBody, cleanSubject, normalizeSender } from '../src/email/parse.ts'
import { tinyPdf } from './fixtures.ts'
import { cookieOf, ORIGIN_HEADERS, PASSWORD, post, setupAdmin, startApp, type TestApp } from './helpers.ts'

const TOKEN = 'test-ingest-token-0123456789abcdefghijklmnop'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const PUBLIC_B64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')

/** DNS for the DKIM keys of the test domains; everything else does not exist. */
async function resolver(name: string, type: string): Promise<string[][]> {
  if (type === 'TXT' && /^sel\._domainkey\.(gmail\.com|evil\.example)$/.test(name)) {
    return [[`v=DKIM1; k=rsa; p=${PUBLIC_B64}`]]
  }
  const error = new Error(`no ${type} for ${name}`) as Error & { code: string }
  error.code = 'ENOTFOUND'
  throw error
}

let counter = 0
/** Builds a mail and signs it like Gmail does (d=gmail.com unless another domain is given). */
async function mail(options: {
  from?: string
  subject: string
  body?: string
  html?: string
  attachments?: { name: string; type: string; data: Buffer; cid?: string }[]
  signDomain?: string | null
  messageId?: string
}): Promise<Buffer> {
  const boundary = 'b1_test'
  const messageId = options.messageId ?? `<test-${++counter}@mail.gmail.com>`
  const head = [
    `From: Maik <${options.from ?? 'maik.dittgen@gmail.com'}>`,
    'To: board@example.de',
    `Subject: ${options.subject}`,
    'Date: Tue, 13 Oct 2026 10:00:00 +0000',
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
  ]
  const textPart = options.html
    ? ['Content-Type: text/html; charset=utf-8', '', options.html]
    : ['Content-Type: text/plain; charset=utf-8', '', options.body ?? '']
  let raw: string
  if (options.attachments?.length) {
    const parts = [[`--${boundary}`, ...textPart].join('\r\n')]
    for (const attachment of options.attachments) {
      parts.push(
        [
          `--${boundary}`,
          `Content-Type: ${attachment.type}; name="${attachment.name}"`,
          `Content-Disposition: ${attachment.cid ? 'inline' : 'attachment'}; filename="${attachment.name}"`,
          ...(attachment.cid ? [`Content-ID: <${attachment.cid}>`] : []),
          'Content-Transfer-Encoding: base64',
          '',
          attachment.data.toString('base64'),
        ].join('\r\n'),
      )
    }
    raw = [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', ...parts, `--${boundary}--`, ''].join(
      '\r\n',
    )
  } else {
    raw = [...head, ...textPart.slice(0, 1), '', textPart[2] ?? '', ''].join('\r\n')
  }
  if (options.signDomain === null) return Buffer.from(raw)
  const signed = await dkimSign(raw, {
    signatureData: [{ signingDomain: options.signDomain ?? 'gmail.com', selector: 'sel', privateKey: PRIVATE_PEM }],
  })
  return Buffer.from(signed.signatures + raw)
}

describe('e-mail helpers', () => {
  it('normalises sender addresses', () => {
    expect(normalizeSender(' M.Dittgen+board@GoogleMail.com ')).toBe('mdittgen@gmail.com')
    expect(normalizeSender('Anna.Muster+x@web.de')).toBe('anna.muster+x@web.de')
    expect(normalizeSender('kein-at')).toBeNull()
  })

  it('cleans subjects and bodies', () => {
    expect(cleanSubject('Fwd: AW: Re: Urlaub')).toBe('Urlaub')
    expect(cleanSubject('WG: Rechnung')).toBe('Rechnung')
    expect(cleanBody('Idee\n\n-- \nMaik Dittgen\nTel. 123')).toBe('Idee')
    expect(cleanBody('Klingt gut\n\nAm Di., 13. Okt. 2026 um 10:00 schrieb Anna <a@b.de>:\n> alt\n> text')).toBe(
      'Klingt gut',
    )
    expect(
      cleanBody(
        'Schau mal\n\n---------- Forwarded message ---------\nVon: Anna <a@b.de>\nDate: Di., 13. Okt.\nSubject: Rezept\nTo: Maik\n\nDas Rezept: Nudeln',
      ),
    ).toBe('Schau mal\n\nDas Rezept: Nudeln')
  })
})

// Ingest endpoint with DKIM checks against a mocked DNS (PLAN.md 5.8, 10).
describe('e-mail ingest', () => {
  let test: TestApp
  let cookie: string
  let boardId: string

  const ingest = (raw: Buffer, token = TOKEN) =>
    test.app.inject({
      method: 'POST',
      url: '/api/ingest/email',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'message/rfc822' },
      payload: raw,
    })

  const inbox = async () =>
    (await test.app.inject({ url: '/api/items?status=inbox', headers: { cookie } })).json<{ items: Item[] }>().items

  /** Waits until the ingest_email job created items matching the filter. */
  const waitFor = async (filter: (item: Item) => boolean, count = 1) => {
    for (let i = 0; i < 200; i++) {
      const found = (await inbox()).filter(filter)
      if (found.length >= count) return found
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('items did not arrive')
  }

  beforeAll(async () => {
    test = await startApp({
      env: { EMAIL_INGEST_TOKEN: TOKEN, EMAIL_ADDRESS: 'board@example.de' },
      queue: { pollMs: 20 },
      email: { resolver },
    })
    cookie = await setupAdmin(test)
    boardId = (await post(test.app, '/api/boards', { name: 'Urlaub', hashtag: 'urlaub' }, cookie)).json().id
  })

  afterAll(async () => {
    await test.app.close()
  })

  it('manages own sender addresses', async () => {
    const empty = (await test.app.inject({ url: '/api/me/email', headers: { cookie } })).json<EmailSettings>()
    expect(empty).toEqual({ enabled: true, address: 'board@example.de', senders: [] })
    const added = await post(test.app, '/api/me/senders', { email: 'Maik.Dittgen@gmail.com' }, cookie)
    expect(added.statusCode).toBe(201)
    expect(added.json()).toEqual([{ email: 'Maik.Dittgen@gmail.com', createdAt: expect.any(Number) }])
    expect((await post(test.app, '/api/me/senders', { email: 'nix' }, cookie)).statusCode).toBe(400)

    // A second user cannot claim the same (normalised) address.
    const invite = (await post(test.app, '/api/admin/invites', { role: 'member' }, cookie)).json<{ url: string }>()
    const token = new URL(invite.url).pathname.split('/').pop() ?? ''
    const anna = cookieOf(
      await post(test.app, `/api/invites/${token}`, { name: 'Anna', email: 'anna@example.test', password: PASSWORD }),
    )
    expect((await post(test.app, '/api/me/senders', { email: 'maikdittgen+x@googlemail.com' }, anna)).statusCode).toBe(
      409,
    )
    await post(test.app, '/api/me/senders', { email: 'weg@example.test' }, cookie)
    const removed = await test.app.inject({
      method: 'DELETE',
      url: '/api/me/senders/weg@example.test',
      headers: { cookie, ...ORIGIN_HEADERS },
    })
    expect(removed.statusCode).toBe(204)
  })

  it('rejects wrong tokens, unknown senders and forged mails', async () => {
    expect(
      (await ingest(await mail({ subject: 'x', body: 'y' }), 'falsch-falsch-falsch-falsch-falsch-1')).statusCode,
    ).toBe(401)
    const stranger = await ingest(await mail({ from: 'fremd@gmail.com', subject: 'Spam', body: 'hallo' }))
    expect(stranger.statusCode).toBe(403)
    expect(stranger.json()).toMatchObject({ reason: 'sender' })
    // No signature at all, signed by another domain, or changed after signing.
    expect((await ingest(await mail({ subject: 'x', body: 'ohne', signDomain: null }))).json()).toMatchObject({
      reason: 'dkim',
    })
    expect(
      (await ingest(await mail({ subject: 'x', body: 'fremd', signDomain: 'evil.example' }))).json(),
    ).toMatchObject({ reason: 'dkim' })
    const tampered = Buffer.from(
      (await mail({ subject: 'x', body: 'original' })).toString().replace('original', 'gefälscht'),
    )
    expect((await ingest(tampered)).json()).toMatchObject({ reason: 'dkim' })
    expect(await inbox()).toEqual([])
  })

  it('Gmail share from Chrome: link card with the page title', async () => {
    const res = await ingest(await mail({ subject: 'Ein Artikel – Zeitung', body: 'https://example.org/artikel\r\n' }))
    expect(res.statusCode).toBe(202)
    const [link] = await waitFor((item) => item.kind === 'link')
    expect(link).toMatchObject({
      source: 'email',
      url: 'https://example.org/artikel',
      title: 'Ein Artikel – Zeitung',
      createdByName: 'Maik',
    })
  })

  it('HTML-only mail with #hashtag in the subject goes to the board', async () => {
    await ingest(await mail({ subject: 'Hotelidee #urlaub', html: '<p>Das <b>Seehotel</b> am Strand</p>' }))
    const [note] = await waitFor((item) => item.note?.includes('Seehotel') ?? false)
    expect(note).toMatchObject({ kind: 'note', title: 'Hotelidee', targetBoardId: boardId })
    expect(note?.note).toBe('Das Seehotel am Strand')
  })

  it('drops signatures and quoted replies, keeps forwarded text', async () => {
    await ingest(
      await mail({
        subject: 'Re: Plan',
        body: 'Neuer Gedanke\r\n\r\nAm Mo., 12. Okt. 2026 schrieb Anna <a@b.de>:\r\n> alter Text\r\n\r\n-- \r\nMaik',
      }),
    )
    const [reply] = await waitFor((item) => item.note === 'Neuer Gedanke')
    expect(reply?.title).toBe('Plan')
    await ingest(
      await mail({
        subject: 'Fwd: Rezept',
        body: '---------- Forwarded message ---------\r\nVon: Anna <a@b.de>\r\nSubject: Rezept\r\n\r\nNudeln mit Pesto',
      }),
    )
    const [forward] = await waitFor((item) => item.note === 'Nudeln mit Pesto')
    expect(forward?.title).toBe('Rezept')
  })

  it('attachments become items; logos, S/MIME and invitations are skipped', async () => {
    const res = await ingest(
      await mail({
        subject: 'Unterlagen',
        body: 'Anbei',
        attachments: [
          { name: 'Rechnung.pdf', type: 'application/pdf', data: tinyPdf() },
          { name: 'notizen.txt', type: 'text/plain', data: Buffer.from('Liste') },
          { name: 'logo.png', type: 'image/png', data: Buffer.alloc(500, 1), cid: 'logo@sig' },
          { name: 'smime.p7s', type: 'application/pkcs7-signature', data: Buffer.alloc(100, 2) },
          { name: 'termin.ics', type: 'text/calendar', data: Buffer.from('BEGIN:VCALENDAR') },
        ],
        messageId: '<anhaenge@mail.gmail.com>',
      }),
    )
    expect(res.statusCode).toBe(202)
    const files = await waitFor((item) => ['Rechnung.pdf', 'notizen.txt'].includes(item.meta.filename ?? ''), 2)
    expect(files.map((item) => item.meta.filename).sort()).toEqual(['Rechnung.pdf', 'notizen.txt'])
    expect(files[0]?.groupId).toBeTruthy()
    expect(files[0]?.groupId).toBe(files[1]?.groupId)
    const all = await inbox()
    expect(all.some((item) => ['logo.png', 'smime.p7s', 'termin.ics'].includes(item.meta.filename ?? ''))).toBe(false)

    // The worker may deliver the same mail twice: no second copy.
    const again = await ingest(
      await mail({ subject: 'Unterlagen', body: 'Anbei', messageId: '<anhaenge@mail.gmail.com>' }),
    )
    expect(again.json()).toEqual(res.json())
  })
})

describe('e-mail off', () => {
  it('has no ingest endpoint without a token', async () => {
    const test = await startApp()
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/ingest/email',
      headers: { authorization: 'Bearer x', 'content-type': 'message/rfc822' },
      payload: Buffer.from('From: a@b.de\r\n\r\nx'),
    })
    expect(res.statusCode).toBe(404)
    await test.app.close()
  })
})
