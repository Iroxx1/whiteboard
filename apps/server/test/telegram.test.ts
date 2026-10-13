import fs from 'node:fs'
import type { Item, TelegramLinkCode, TelegramStatus } from '@wb/shared'
import type { Transformer } from 'grammy'
import type { Message, Update, User } from 'grammy/types'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TELEGRAM_MAX_BYTES, TEXTS } from '../src/telegram/bot.ts'
import { jpegWithExif, tinyPdf } from './fixtures.ts'
import { ORIGIN_HEADERS, post, setupAdmin, startApp, type TestApp } from './helpers.ts'

const TOKEN = '123456:TEST-token-for-the-mocked-bot-api'
const MAIK = { id: 1001, is_bot: false, first_name: 'Maik', username: 'maik' }
const STRANGER = { id: 2002, is_bot: false, first_name: 'Fremd' }

type Call = { method: string; payload: Record<string, unknown> }

// Telegram handlers with a mocked Bot API (PLAN.md 5.7, 10): updates go in via handleUpdate,
// every API call is answered by the transformer below.
describe('telegram bot', () => {
  let test: TestApp
  let cookie: string
  let boardId: string
  const calls: Call[] = []
  const files = new Map<string, Buffer>()
  let nextMessageId = 5000
  let nextUpdateId = 1
  let messageId = 100

  const transformer: Transformer = async (_prev, method, payload) => {
    const body = (payload ?? {}) as Record<string, unknown>
    calls.push({ method, payload: body })
    let result: unknown = true
    if (method === 'sendMessage') {
      result = { message_id: nextMessageId++, date: 0, chat: { id: body.chat_id, type: 'private' }, text: body.text }
    } else if (method === 'getFile') {
      result = { file_id: body.file_id, file_unique_id: 'u', file_path: `docs/${String(body.file_id)}` }
    }
    return { ok: true, result } as never
  }

  const telegram = () => test.app.telegram

  const send = async (from: User, message: Partial<Message>) => {
    const update = {
      update_id: nextUpdateId++,
      message: {
        message_id: messageId++,
        date: 0,
        chat: { id: from.id, type: 'private', first_name: from.first_name },
        from,
        ...message,
      },
    } as Update
    await telegram().handleUpdate(update)
  }

  const press = async (from: User, replyMessageId: number, data: string) => {
    const update = {
      update_id: nextUpdateId++,
      callback_query: {
        id: String(nextUpdateId),
        from,
        chat_instance: 'x',
        data,
        message: {
          message_id: replyMessageId,
          date: 0,
          chat: { id: from.id, type: 'private', first_name: from.first_name },
        },
      },
    } as Update
    await telegram().handleUpdate(update)
  }

  const replies = () => calls.filter((call) => call.method === 'sendMessage')
  const lastReply = () => replies().at(-1)
  const lastReplyId = () => nextMessageId - 1
  const inbox = async () =>
    (await test.app.inject({ url: '/api/items?status=inbox', headers: { cookie } })).json<{ items: Item[] }>().items

  beforeAll(async () => {
    test = await startApp({
      env: { TELEGRAM_BOT_TOKEN: TOKEN },
      queue: { pollMs: 20 },
      telegram: {
        botInfo: {
          id: 42,
          is_bot: true,
          first_name: 'Whiteboard',
          username: 'wb_test_bot',
          can_join_groups: false,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
          can_connect_to_business: false,
          has_main_web_app: false,
          has_topics_enabled: false,
          allows_users_to_create_topics: false,
        } as never,
        transformer,
        poll: false,
        albumDelayMs: 60_000,
        download: async (filePath, target) => {
          const data = files.get(filePath.replace('docs/', ''))
          if (!data) throw new Error(`unknown file ${filePath}`)
          fs.writeFileSync(target, data)
        },
      },
    })
    cookie = await setupAdmin(test)
    boardId = (await post(test.app, '/api/boards', { name: 'Urlaub', hashtag: 'urlaub' }, cookie)).json().id
  })

  afterAll(async () => {
    await test.app.close()
  })

  beforeEach(() => {
    calls.length = 0
  })

  it('ignores unknown senders after one notice', async () => {
    await send(STRANGER, { text: 'hallo' })
    await send(STRANGER, { text: 'noch mal' })
    expect(replies().map((call) => call.payload.text)).toEqual([TEXTS.private])
    expect(await inbox()).toEqual([])
  })

  it('links an account with the one-time code', async () => {
    const status = (await test.app.inject({ url: '/api/me/telegram', headers: { cookie } })).json<TelegramStatus>()
    expect(status).toEqual({ enabled: true, botUsername: 'wb_test_bot', linked: null })
    const res = await post(test.app, '/api/me/telegram/link-code', {}, cookie)
    expect(res.statusCode).toBe(201)
    const { url } = res.json<TelegramLinkCode>()
    const code = new URL(url).searchParams.get('start') ?? ''
    expect(url).toMatch(/^https:\/\/t\.me\/wb_test_bot\?start=[A-Za-z0-9_-]{24}$/)

    await send(MAIK, { text: '/start falsch', entities: [{ type: 'bot_command', offset: 0, length: 6 }] })
    expect(lastReply()?.payload.text).toBe(TEXTS.linkInvalid)

    await send(MAIK, { text: `/start ${code}`, entities: [{ type: 'bot_command', offset: 0, length: 6 }] })
    expect(lastReply()?.payload.text).toBe(TEXTS.linked('Maik'))
    // The code works only once.
    await send(STRANGER, { text: `/start ${code}`, entities: [{ type: 'bot_command', offset: 0, length: 6 }] })
    expect(lastReply()?.payload.text).toBe(TEXTS.linkInvalid)

    const linked = (await test.app.inject({ url: '/api/me/telegram', headers: { cookie } })).json<TelegramStatus>()
    expect(linked.linked).toEqual({ username: 'maik', linkedAt: expect.any(Number) })
  })

  it('stores text and links with hashtag routing and answers with buttons', async () => {
    await send(MAIK, { text: 'Tolle Idee für später' })
    expect(lastReply()?.payload).toMatchObject({ text: TEXTS.inInbox, reply_markup: expect.anything() })

    await send(MAIK, { text: 'Hotel https://example.org/hotel #urlaub' })
    expect(lastReply()?.payload.text).toBe(TEXTS.onBoard('Urlaub'))

    await send(MAIK, { text: 'Was ist das #gibtsnicht' })
    expect(String(lastReply()?.payload.text)).toContain('Unbekannter Hashtag #gibtsnicht')
    expect(String(lastReply()?.payload.text)).toContain('#urlaub')

    const items = await inbox()
    const link = items.find((item) => item.kind === 'link')
    expect(link).toMatchObject({
      source: 'telegram',
      url: 'https://example.org/hotel',
      note: 'Hotel',
      targetBoardId: boardId,
      createdByName: 'Maik',
    })
    expect(items.find((item) => item.note === 'Tolle Idee für später')).toMatchObject({ kind: 'note' })
  })

  it('stores photos, documents, voice messages, locations, contacts and forwards', async () => {
    files.set('photo-big', await jpegWithExif())
    files.set('pdf', tinyPdf())
    const voice = Buffer.alloc(64)
    voice.write('OggS', 0)
    voice.write('OpusHead', 28)
    files.set('voice', voice)
    await send(MAIK, {
      photo: [
        { file_id: 'photo-small', file_unique_id: 'a', width: 90, height: 60 },
        { file_id: 'photo-big', file_unique_id: 'b', width: 300, height: 200, file_size: 2000 },
      ],
      caption: 'Sonnenuntergang',
    })
    await send(MAIK, {
      document: { file_id: 'pdf', file_unique_id: 'c', file_name: 'Rechnung.pdf', mime_type: 'application/pdf' },
    })
    await send(MAIK, { voice: { file_id: 'voice', file_unique_id: 'd', duration: 3, mime_type: 'audio/ogg' } })
    await send(MAIK, {
      venue: { location: { latitude: 52.52, longitude: 13.405 }, title: 'Brandenburger Tor', address: 'Pariser Platz' },
      location: { latitude: 52.52, longitude: 13.405 },
    })
    await send(MAIK, { contact: { phone_number: '+49 30 123', first_name: 'Anna', last_name: 'Muster' } })
    await send(MAIK, {
      text: 'Lesenswert',
      forward_origin: { type: 'hidden_user', sender_user_name: 'Bernd', date: 0 },
    })

    const items = await inbox()
    expect(items.find((item) => item.note === 'Sonnenuntergang')).toMatchObject({
      kind: 'image',
      meta: expect.objectContaining({ filename: 'foto-' + String(messageId - 6) + '.jpg' }),
    })
    expect(calls.filter((call) => call.method === 'getFile').map((call) => call.payload.file_id)).toContain('photo-big')
    expect(items.find((item) => item.meta.filename === 'Rechnung.pdf')).toMatchObject({ kind: 'pdf' })
    expect(items.find((item) => item.meta.filename?.startsWith('sprachnachricht-'))).toMatchObject({ kind: 'audio' })
    expect(items.find((item) => item.url?.includes('openstreetmap.org'))).toMatchObject({
      kind: 'link',
      title: 'Brandenburger Tor – Pariser Platz',
      url: 'https://www.openstreetmap.org/?mlat=52.520000&mlon=13.405000#map=17/52.520000/13.405000',
    })
    expect(items.find((item) => item.note?.startsWith('👤 Anna Muster'))).toMatchObject({
      kind: 'note',
      note: '👤 Anna Muster\nTelefon: +49 30 123',
    })
    expect(items.find((item) => item.note?.startsWith('Weitergeleitet von Bernd'))).toMatchObject({
      note: 'Weitergeleitet von Bernd\n\nLesenswert',
    })
  })

  it('collects albums into one group', async () => {
    files.set('a1', await jpegWithExif())
    files.set('a2', await jpegWithExif())
    await send(MAIK, {
      media_group_id: 'g1',
      photo: [{ file_id: 'a1', file_unique_id: 'e', width: 3, height: 2 }],
      caption: 'Album #urlaub',
    })
    await send(MAIK, { media_group_id: 'g1', photo: [{ file_id: 'a2', file_unique_id: 'f', width: 3, height: 2 }] })
    expect(replies()).toHaveLength(0)
    await telegram().flushAlbums()
    expect(replies()).toHaveLength(1)
    expect(lastReply()?.payload.text).toBe(TEXTS.onBoard('Urlaub'))
    const album = (await inbox()).filter(
      (item) =>
        item.meta.filename === `foto-${messageId - 2}.jpg` || item.meta.filename === `foto-${messageId - 1}.jpg`,
    )
    expect(album).toHaveLength(2)
    expect(album[0]?.groupId).toBeTruthy()
    expect(album[0]?.groupId).toBe(album[1]?.groupId)
  })

  it('refuses files over 20 MB with a hint', async () => {
    await send(MAIK, {
      video: {
        file_id: 'huge',
        file_unique_id: 'g',
        width: 1,
        height: 1,
        duration: 1,
        file_size: TELEGRAM_MAX_BYTES + 1,
      },
    })
    expect(lastReply()?.payload.text).toBe(TEXTS.tooLarge)
    expect(calls.some((call) => call.method === 'getFile')).toBe(false)
  })

  it('buttons: board, note, delete', async () => {
    await send(MAIK, { text: 'Knopf-Test' })
    const reply = lastReplyId()
    const item = (await inbox()).find((entry) => entry.note === 'Knopf-Test')
    if (!item) throw new Error('missing item')

    await press(MAIK, reply, 'pick')
    const picker = calls.find((call) => call.method === 'editMessageText')
    expect(JSON.stringify(picker?.payload.reply_markup)).toContain(`b:${boardId}`)

    await press(MAIK, reply, `b:${boardId}`)
    expect(calls.filter((call) => call.method === 'editMessageText').at(-1)?.payload.text).toBe(TEXTS.onBoard('Urlaub'))
    expect((await inbox()).find((entry) => entry.id === item.id)?.targetBoardId).toBe(boardId)

    await press(MAIK, reply, 'note')
    expect(lastReply()?.payload).toMatchObject({ text: TEXTS.notePrompt, reply_markup: { force_reply: true } })
    const prompt = lastReplyId()
    await send(MAIK, {
      text: 'Neue Notiz',
      reply_to_message: {
        message_id: prompt,
        date: 0,
        chat: { id: MAIK.id, type: 'private', first_name: 'Maik' },
      } as never,
    })
    expect(lastReply()?.payload.text).toBe(TEXTS.noteSaved)
    expect((await inbox()).find((entry) => entry.id === item.id)?.note).toBe('Neue Notiz')

    await press(MAIK, reply, 'del')
    expect(calls.filter((call) => call.method === 'editMessageText').at(-1)?.payload.text).toBe(TEXTS.deleted)
    expect((await inbox()).find((entry) => entry.id === item.id)).toBeUndefined()
  })

  it('commands: /boards, /inbox, /trennen', async () => {
    const command = (text: string) =>
      send(MAIK, { text, entities: [{ type: 'bot_command', offset: 0, length: text.length }] })
    await command('/boards')
    expect(lastReply()?.payload.text).toBe(TEXTS.boards(['• Urlaub – #urlaub']))
    await command('/inbox')
    expect(String(lastReply()?.payload.text)).toMatch(/^In der Inbox: \d+/)
    await command('/trennen')
    expect(lastReply()?.payload.text).toBe(TEXTS.unlinked)
    const status = (await test.app.inject({ url: '/api/me/telegram', headers: { cookie } })).json<TelegramStatus>()
    expect(status.linked).toBeNull()
    // Unlinked: further messages are ignored (the notice was sent to this account only if never before).
    const before = (await inbox()).length
    await send(MAIK, { text: 'nach dem Trennen' })
    expect((await inbox()).length).toBe(before)
  })

  it('unlinks from the settings page', async () => {
    const res = await test.app.inject({
      method: 'DELETE',
      url: '/api/me/telegram',
      headers: { cookie, ...ORIGIN_HEADERS },
    })
    expect(res.statusCode).toBe(204)
  })
})

describe('telegram off', () => {
  it('reports the bot as unavailable without a token', async () => {
    const test = await startApp()
    const cookie = await setupAdmin(test)
    const status = (await test.app.inject({ url: '/api/me/telegram', headers: { cookie } })).json<TelegramStatus>()
    expect(status).toEqual({ enabled: false, botUsername: null, linked: null })
    expect((await post(test.app, '/api/me/telegram/link-code', {}, cookie)).statusCode).toBe(503)
    await test.app.close()
  })
})
