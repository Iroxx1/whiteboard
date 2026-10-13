import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { type Item, ulid } from '@wb/shared'
import { and, count, desc, eq, isNull, lt } from 'drizzle-orm'
import type { FastifyBaseLogger as Logger } from 'fastify'
import { Bot, type Context, GrammyError, InlineKeyboard, type Transformer } from 'grammy'
import type { InlineKeyboardMarkup, Message, UserFromGetMe } from 'grammy/types'
import type { Db } from '../db/index.ts'
import { boards, items, telegramMessages } from '../db/schema.ts'
import type { IngestFile } from '../ingest/normalize.ts'
import { IngestError, type ItemService } from '../items/service.ts'
import { RateLimiter } from '../lib/rateLimit.ts'
import { type LinkedUser, TelegramLinks } from './links.ts'

/** getFile only works up to 20 MB (Bot API). */
export const TELEGRAM_MAX_BYTES = 20 * 1024 * 1024
const RECENT_BOARDS = 8
const MAX_BOARD_BUTTONS = 60
const RETRY_MS = 60_000
const MESSAGE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

export const TEXTS = {
  private: 'Dieser Bot ist privat.',
  linked: (name: string) =>
    `✅ Verknüpft mit dem Whiteboard-Konto „${name}“.\n\nSchick mir einfach Links, Text, Fotos, Dateien, Sprachnachrichten, Videos oder Standorte – alles landet in der Inbox.`,
  linkInvalid:
    'Der Verknüpfungslink ist ungültig oder abgelaufen. Bitte in der App unter Einstellungen → „Telegram verbinden“ einen neuen erzeugen.',
  help: [
    'Alles, was du mir schickst, landet in der Whiteboard-Inbox: Links, Text, Fotos und Alben, Dateien, Sprachnachrichten, Videos, Standorte und Kontakte.',
    '',
    'Bildunterschrift bzw. Begleittext werden zur Notiz. Mit #hashtag landet der Inhalt direkt auf dem Board mit diesem Hashtag (#inbox = nur Inbox).',
    '',
    '/boards – Boards mit Hashtags',
    '/inbox – was gerade in der Inbox liegt',
    '/trennen – Verknüpfung mit dem Konto lösen',
    '/hilfe – diese Hilfe',
  ].join('\n'),
  inInbox: '✅ In der Inbox',
  onBoard: (name: string) => `✅ Auf Board ‚${name}‘`,
  duplicate: '(war schon in der Inbox)',
  tooLarge: 'Zu groß für Telegram-Bots (max. 20 MB) – bitte über Teilen → Whiteboard senden (bis 100 MB).',
  nothing:
    'Damit kann ich nichts anfangen – schick mir Text, Links, Fotos, Dateien, Sprachnachrichten, Videos oder Standorte.',
  failed: '⚠️ Speichern fehlgeschlagen. Bitte später noch einmal versuchen.',
  rateLimited: '⏳ Zu viele Nachrichten auf einmal – bitte kurz warten.',
  unknownHashtags: (tags: string[], known: string[]) =>
    `Unbekannter Hashtag ${tags.map((tag) => `#${tag}`).join(', ')}.${known.length ? ` Boards: ${known.map((tag) => `#${tag}`).join(', ')}` : ' Es gibt noch keine Boards.'}`,
  pickBoard: 'Auf welches Board?',
  notePrompt: '✏️ Schick mir die Notiz als Antwort auf diese Nachricht.',
  noteSaved: '✏️ Notiz gespeichert.',
  deleted: '🗑️ gelöscht',
  gone: 'Nicht mehr verfügbar.',
  boardGone: 'Dieses Board gibt es nicht mehr.',
  noBoards: 'Es gibt noch keine Boards.',
  boards: (lines: string[]) => `Boards:\n${lines.join('\n')}`,
  inbox: (count: number, lines: string[]) =>
    count === 0 ? 'Die Inbox ist leer.' : `In der Inbox: ${count}\n\nNeueste:\n${lines.join('\n')}`,
  unlinked: 'Verknüpfung gelöst. Ich nehme von diesem Telegram-Konto nichts mehr an.',
  forwarded: (from: string) => `Weitergeleitet von ${from}`,
}

const BUTTONS = { pick: '📋 Auf Board legen', note: '✏️ Notiz', del: '🗑️ Löschen', more: 'Mehr …', back: '⬅️ Zurück' }

export type TelegramOptions = {
  /** Tests: skip getMe. */
  botInfo?: UserFromGetMe
  /** Tests: answer Bot API calls without network. */
  transformer?: Transformer
  /** Tests: deliver file contents instead of downloading them. */
  download?: (filePath: string, target: string) => Promise<void>
  /** Wait for further album parts (PLAN.md 5.7: 1.5 s). */
  albumDelayMs?: number
  /** Tests: no long polling. */
  poll?: boolean
}

type FileRef = { fileId: string; size: number | undefined; name: string; mime: string | undefined }

type Collected = { text: string[]; title?: string; url?: string; files: FileRef[] }

function senderName(origin: NonNullable<Message['forward_origin']>): string {
  switch (origin.type) {
    case 'user':
      return [origin.sender_user.first_name, origin.sender_user.last_name].filter(Boolean).join(' ')
    case 'hidden_user':
      return origin.sender_user_name
    case 'chat':
      return origin.sender_chat.title ?? 'Chat'
    case 'channel':
      return origin.chat.title ?? 'Kanal'
  }
}

/** Links behind words ("text_link" entities) are invisible in the plain text. */
function hiddenLinks(message: Message): string[] {
  const entities = message.entities ?? message.caption_entities ?? []
  return entities.flatMap((entity) => (entity.type === 'text_link' ? [entity.url] : []))
}

/** What one message contributes to the ingest payload (PLAN.md 5.7, table). */
export function collect(message: Message): Collected {
  const out: Collected = { text: [], files: [] }
  if (message.forward_origin) out.text.push(TEXTS.forwarded(senderName(message.forward_origin)))
  const body = message.text ?? message.caption
  if (body) out.text.push(body)
  const links = hiddenLinks(message).filter((url) => !body?.includes(url))
  if (links.length) out.text.push(links.join('\n'))

  const id = message.message_id
  if (message.photo?.length) {
    const largest = message.photo.reduce((best, photo) =>
      photo.width * photo.height > best.width * best.height ? photo : best,
    )
    out.files.push({ fileId: largest.file_id, size: largest.file_size, name: `foto-${id}.jpg`, mime: 'image/jpeg' })
  }
  if (message.document) {
    const doc = message.document
    out.files.push({
      fileId: doc.file_id,
      size: doc.file_size,
      name: doc.file_name ?? `datei-${id}`,
      mime: doc.mime_type,
    })
  }
  if (message.voice) {
    const voice = message.voice
    out.files.push({
      fileId: voice.file_id,
      size: voice.file_size,
      name: `sprachnachricht-${id}.ogg`,
      mime: voice.mime_type ?? 'audio/ogg',
    })
  }
  if (message.audio) {
    const audio = message.audio
    const name = audio.file_name ?? ([audio.performer, audio.title].filter(Boolean).join(' – ') || `audio-${id}`)
    out.files.push({ fileId: audio.file_id, size: audio.file_size, name, mime: audio.mime_type })
  }
  if (message.video) {
    const video = message.video
    out.files.push({
      fileId: video.file_id,
      size: video.file_size,
      name: video.file_name ?? `video-${id}.mp4`,
      mime: video.mime_type ?? 'video/mp4',
    })
  }
  if (message.video_note) {
    const note = message.video_note
    out.files.push({ fileId: note.file_id, size: note.file_size, name: `videonachricht-${id}.mp4`, mime: 'video/mp4' })
  }
  // Animations (GIFs) also carry a `document` with the same file; take it only once.
  if (message.animation && !message.document) {
    const animation = message.animation
    out.files.push({
      fileId: animation.file_id,
      size: animation.file_size,
      name: animation.file_name ?? `animation-${id}.mp4`,
      mime: animation.mime_type ?? 'video/mp4',
    })
  }
  const location = message.venue?.location ?? message.location
  if (location) {
    const lat = location.latitude.toFixed(6)
    const lon = location.longitude.toFixed(6)
    out.url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`
    if (message.venue) out.title = [message.venue.title, message.venue.address].filter(Boolean).join(' – ')
  }
  if (message.contact) {
    const contact = message.contact
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
    out.text.push(
      [`👤 ${name}`, contact.phone_number ? `Telefon: ${contact.phone_number}` : null].filter(Boolean).join('\n'),
    )
  }
  return out
}

function itemLabel(item: Pick<Item, 'title' | 'note' | 'url' | 'meta' | 'kind'>): string {
  const text = item.title ?? item.note?.split('\n')[0] ?? item.meta.filename ?? item.url ?? item.kind
  return text.length > 60 ? `${text.slice(0, 59)}…` : text
}

/**
 * Telegram bot (PLAN.md 5.7): long polling inside the app process, private chats only, linked
 * users only. Everything goes through the same ingest as the other channels.
 */
export class TelegramService {
  readonly links: TelegramLinks
  private bot: Bot | null = null
  private running = false
  private stopped = false
  private retryTimer: NodeJS.Timeout | undefined
  private readonly albums = new Map<string, { messages: Message[]; timer: NodeJS.Timeout; user: LinkedUser }>()
  /** Unknown senders get the "private" notice once per app run. */
  private readonly strangers = new Set<number>()
  private readonly limiter = new RateLimiter(120, 10 * 60 * 1000)
  private readonly albumDelayMs: number

  constructor(
    private readonly db: Db,
    private readonly itemService: ItemService,
    private readonly log: Logger,
    private readonly tmpDir: string,
    private readonly token: string | undefined,
    private readonly options: TelegramOptions = {},
  ) {
    this.links = new TelegramLinks(db)
    this.albumDelayMs = options.albumDelayMs ?? 1500
    if (token) {
      // grammY's own node-fetch: with Node's built-in fetch the API calls hang (seen on CT 118).
      this.bot = new Bot(token, options.botInfo ? { botInfo: options.botInfo } : {})
      if (options.transformer) this.bot.api.config.use(options.transformer)
      this.registerHandlers(this.bot)
    }
  }

  /** Bot configured and its identity known (getMe succeeded). */
  get enabled(): boolean {
    return this.bot?.isInited() ?? false
  }

  get username(): string | null {
    return this.enabled ? (this.bot?.botInfo.username ?? null) : null
  }

  get isRunning(): boolean {
    return this.running
  }

  /** Starts long polling in the background; errors (e.g. wrong token) are logged, not thrown. */
  /**
   * Connects in the background so the app starts even when Telegram is unreachable; retries every
   * minute, except for a rejected token.
   */
  start() {
    void this.connect()
  }

  private async connect() {
    const bot = this.bot
    if (!bot) return
    while (!this.stopped) {
      try {
        await bot.init(AbortSignal.timeout(30_000))
        break
      } catch (error) {
        if (error instanceof GrammyError && (error.error_code === 401 || error.error_code === 404)) {
          this.log.error('telegram: token rejected, bot stays off (check TELEGRAM_BOT_TOKEN)')
          return
        }
        this.log.warn({ err: this.redact(error) }, 'telegram: not reachable, retrying in 60 s')
        await new Promise((resolve) => {
          this.retryTimer = setTimeout(resolve, RETRY_MS)
          this.retryTimer.unref()
        })
      }
    }
    if (this.stopped) return
    await bot.api
      .setMyCommands([
        { command: 'hilfe', description: 'Hilfe' },
        { command: 'boards', description: 'Boards mit Hashtags' },
        { command: 'inbox', description: 'Was in der Inbox liegt' },
        { command: 'trennen', description: 'Verknüpfung lösen' },
      ])
      .catch(() => undefined)
    if (this.options.poll === false) return
    this.running = true
    bot
      .start({
        allowed_updates: ['message', 'callback_query'],
        onStart: (info) => this.log.info({ bot: info.username }, 'telegram bot polling'),
      })
      .catch((error: unknown) => this.log.error({ err: this.redact(error) }, 'telegram polling stopped'))
      .finally(() => {
        this.running = false
      })
  }

  async stop() {
    this.stopped = true
    clearTimeout(this.retryTimer)
    for (const album of this.albums.values()) clearTimeout(album.timer)
    this.albums.clear()
    if (this.bot?.isRunning()) await this.bot.stop()
  }

  /** Tests: feed an update without polling. */
  async handleUpdate(update: Parameters<Bot['handleUpdate']>[0]) {
    await this.bot?.handleUpdate(update)
  }

  /** Tests: deliver collected albums at once. */
  async flushAlbums() {
    const pending = [...this.albums.entries()]
    this.albums.clear()
    for (const [, album] of pending) {
      clearTimeout(album.timer)
      await this.ingestMessages(album.user, album.messages)
    }
  }

  purgeOld(now = Date.now()) {
    this.db
      .delete(telegramMessages)
      .where(lt(telegramMessages.createdAt, now - MESSAGE_RETENTION_MS))
      .run()
  }

  /** The token is part of Bot API URLs; keep it out of the log (PLAN.md 8.7). */
  private redact(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return { message: this.token ? message.replaceAll(this.token, '***') : message }
  }

  // --- handlers -------------------------------------------------------------------------------

  private registerHandlers(bot: Bot) {
    bot.catch((error) => this.log.error({ err: this.redact(error.error) }, 'telegram handler failed'))

    // Private chats only; groups and channels are ignored (PLAN.md 5.7).
    bot.use(async (ctx, next) => {
      if (ctx.chat?.type !== 'private' || !ctx.from || ctx.from.is_bot) return
      await next()
    })

    bot.command('start', async (ctx) => {
      const code = ctx.match.trim()
      if (code) {
        const user = this.links.redeem(code, ctx.from?.id ?? 0, ctx.from?.username ?? null)
        if (!user) {
          await ctx.reply(TEXTS.linkInvalid)
          return
        }
        this.strangers.delete(ctx.from?.id ?? 0)
        this.log.info({ userId: user.id }, 'telegram account linked')
        await ctx.reply(TEXTS.linked(user.name))
        return
      }
      if (this.links.userFor(ctx.from?.id ?? 0)) await ctx.reply(TEXTS.help)
      else await this.stranger(ctx)
    })

    // Everything below needs a linked account.
    bot.use(async (ctx, next) => {
      const user = this.links.userFor(ctx.from?.id ?? 0)
      if (!user) {
        if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => undefined)
        await this.stranger(ctx)
        return
      }
      if (!this.limiter.take(String(ctx.from?.id))) {
        if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: TEXTS.rateLimited }).catch(() => undefined)
        else await ctx.reply(TEXTS.rateLimited)
        return
      }
      ;(ctx as Context & { wbUser: LinkedUser }).wbUser = user
      await next()
    })

    bot.command(['hilfe', 'help'], (ctx) => ctx.reply(TEXTS.help))
    bot.command('boards', (ctx) => ctx.reply(this.boardList()))
    bot.command('inbox', (ctx) => ctx.reply(this.inboxSummary()))
    bot.command('trennen', async (ctx) => {
      this.links.unlinkTelegram(ctx.from?.id ?? 0)
      await ctx.reply(TEXTS.unlinked)
    })

    bot.on('callback_query:data', (ctx) => this.onButton(ctx))

    bot.on('message', async (ctx) => {
      const user = (ctx as Context & { wbUser: LinkedUser }).wbUser
      const message = ctx.message
      if (!message) return
      // Answer to "send me the note" (force_reply).
      const replyTo = message.reply_to_message
      if (replyTo && message.text) {
        const prompt = this.mapping(message.chat.id, replyTo.message_id, 'note_prompt')
        if (prompt) {
          const [first] = prompt
          if (first) this.itemService.update(first, { note: message.text.trim() || null })
          await ctx.reply(TEXTS.noteSaved)
          return
        }
      }
      // Albums arrive as several messages with the same media_group_id (PLAN.md 5.7: 1.5 s).
      if (message.media_group_id) {
        const key = `${message.chat.id}:${message.media_group_id}`
        const album = this.albums.get(key)
        if (album) {
          album.messages.push(message)
          return
        }
        const timer = setTimeout(() => {
          const done = this.albums.get(key)
          this.albums.delete(key)
          if (done) void this.ingestMessages(done.user, done.messages)
        }, this.albumDelayMs)
        timer.unref()
        this.albums.set(key, { messages: [message], timer, user })
        return
      }
      await this.ingestMessages(user, [message])
    })
  }

  private async stranger(ctx: Context) {
    const id = ctx.from?.id
    if (!id || this.strangers.has(id)) return
    this.strangers.add(id)
    await ctx.reply(TEXTS.private).catch(() => undefined)
  }

  // --- ingest ---------------------------------------------------------------------------------

  private async ingestMessages(user: LinkedUser, messages: Message[]) {
    const bot = this.bot
    const first = messages[0]
    if (!bot || !first) return
    const chatId = first.chat.id
    const sorted = [...messages].sort((a, b) => a.message_id - b.message_id)
    const parts = sorted.map(collect)
    const text = parts.flatMap((part) => part.text).join('\n\n')
    const title = parts.find((part) => part.title)?.title
    const url = parts.find((part) => part.url)?.url
    const refs = parts.flatMap((part) => part.files)
    const tooLarge = refs.some((ref) => (ref.size ?? 0) > TELEGRAM_MAX_BYTES)
    const send = (body: string, markup?: InlineKeyboardMarkup) =>
      bot.api.sendMessage(chatId, body, {
        reply_parameters: { message_id: first.message_id, allow_sending_without_reply: true },
        ...(markup ? { reply_markup: markup } : {}),
      })

    const files: IngestFile[] = []
    try {
      for (const ref of refs) {
        if ((ref.size ?? 0) > TELEGRAM_MAX_BYTES) continue
        files.push(await this.download(ref))
      }
    } catch (error) {
      for (const file of files) fs.rmSync(file.tmpPath, { force: true })
      // getFile refuses files over 20 MB even when Telegram did not tell the size beforehand.
      if (error instanceof GrammyError && /too big/i.test(error.description)) {
        await send(TEXTS.tooLarge)
        return
      }
      this.log.error({ err: this.redact(error) }, 'telegram download failed')
      await send(TEXTS.failed)
      return
    }

    if (files.length === 0 && !text && !url && !title) {
      await send(tooLarge ? TEXTS.tooLarge : TEXTS.nothing)
      return
    }

    let result: Awaited<ReturnType<ItemService['ingest']>>
    try {
      result = await this.itemService.ingest({
        userId: user.id,
        source: 'telegram',
        text: text || undefined,
        title,
        url,
        files,
        sourceMeta: { chatId, messageIds: sorted.map((message) => message.message_id) },
      })
    } catch (error) {
      for (const file of files) fs.rmSync(file.tmpPath, { force: true })
      if (error instanceof IngestError) {
        await send(tooLarge ? TEXTS.tooLarge : TEXTS.nothing)
        return
      }
      this.log.error({ err: this.redact(error) }, 'telegram ingest failed')
      await send(TEXTS.failed)
      return
    }

    const lines = [this.statusLine(result.items)]
    if (result.duplicateIds.length > 0 && result.duplicateIds.length === result.items.length)
      lines.push(TEXTS.duplicate)
    if (tooLarge) lines.push(TEXTS.tooLarge)
    if (result.unknownHashtags.length > 0)
      lines.push(TEXTS.unknownHashtags(result.unknownHashtags, [...this.itemService.boardsByHashtag().keys()].sort()))
    const reply = await send(lines.join('\n\n'), this.mainKeyboard())
    this.remember(
      chatId,
      reply.message_id,
      'reply',
      result.items.map((item) => item.id),
    )
  }

  private async download(ref: FileRef): Promise<IngestFile> {
    const bot = this.bot
    if (!bot) throw new Error('bot off')
    const file = await bot.api.getFile(ref.fileId)
    if (!file.file_path) throw new Error('no file path')
    const tmpPath = path.join(this.tmpDir, `${ulid()}.telegram`)
    if (this.options.download) {
      await this.options.download(file.file_path, tmpPath)
    } else {
      const response = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`, {
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok || !response.body) throw new Error(`file download failed: ${response.status}`)
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
        fs.createWriteStream(tmpPath),
      )
    }
    const size = fs.statSync(tmpPath).size
    if (size > TELEGRAM_MAX_BYTES) {
      fs.rmSync(tmpPath, { force: true })
      throw new Error('file too large')
    }
    return { filename: ref.name, mime: ref.mime, size, tmpPath }
  }

  private statusLine(list: Pick<Item, 'targetBoardName'>[]): string {
    const board = list.find((item) => item.targetBoardName)?.targetBoardName
    return board ? TEXTS.onBoard(board) : TEXTS.inInbox
  }

  // --- buttons --------------------------------------------------------------------------------

  private mainKeyboard(): InlineKeyboardMarkup {
    return new InlineKeyboard().text(BUTTONS.pick, 'pick').row().text(BUTTONS.note, 'note').text(BUTTONS.del, 'del')
  }

  private boardKeyboard(all: boolean): InlineKeyboardMarkup {
    const rows = this.db
      .select({ id: boards.id, name: boards.name })
      .from(boards)
      .where(isNull(boards.deletedAt))
      .orderBy(all ? boards.name : desc(boards.updatedAt))
      .limit(all ? MAX_BOARD_BUTTONS : RECENT_BOARDS + 1)
      .all()
    const keyboard = new InlineKeyboard()
    const shown = all ? rows : rows.slice(0, RECENT_BOARDS)
    for (const [index, board] of shown.entries()) {
      keyboard.text(board.name.slice(0, 40), `b:${board.id}`)
      if (index % 2 === 1) keyboard.row()
    }
    if (shown.length % 2 === 1) keyboard.row()
    if (!all && rows.length > RECENT_BOARDS) keyboard.text(BUTTONS.more, 'more')
    keyboard.text(BUTTONS.back, 'back')
    return keyboard
  }

  private async onButton(ctx: Context) {
    const query = ctx.callbackQuery
    const message = query?.message
    const data = query?.data ?? ''
    if (!query || !message) return
    const ids = this.mapping(message.chat.id, message.message_id, 'reply')
    const alive = ids ? this.itemService.byIds(ids).filter((item) => item.status !== 'trashed') : []
    if (!ids || alive.length === 0) {
      await ctx.answerCallbackQuery({ text: TEXTS.gone })
      await ctx.editMessageReplyMarkup().catch(() => undefined)
      return
    }
    if (data === 'pick' || data === 'more') {
      const keyboard = this.boardKeyboard(data === 'more')
      await ctx.answerCallbackQuery()
      if (keyboard.inline_keyboard.length <= 1) {
        await ctx.reply(TEXTS.noBoards)
        return
      }
      await ctx.editMessageText(`${this.statusLine(alive)}\n\n${TEXTS.pickBoard}`, { reply_markup: keyboard })
      return
    }
    if (data === 'back') {
      await ctx.answerCallbackQuery()
      await ctx.editMessageText(this.statusLine(alive), { reply_markup: this.mainKeyboard() })
      return
    }
    if (data.startsWith('b:')) {
      const boardId = data.slice(2)
      const updated = alive.map((item) => this.itemService.update(item.id, { targetBoardId: boardId }))
      if (updated.some((item) => item === null)) {
        await ctx.answerCallbackQuery({ text: TEXTS.boardGone })
        return
      }
      await ctx.answerCallbackQuery()
      await ctx.editMessageText(this.statusLine(updated as Item[]), { reply_markup: this.mainKeyboard() })
      return
    }
    if (data === 'note') {
      await ctx.answerCallbackQuery()
      const prompt = await ctx.reply(TEXTS.notePrompt, {
        reply_markup: { force_reply: true, input_field_placeholder: 'Notiz' },
      })
      this.remember(
        message.chat.id,
        prompt.message_id,
        'note_prompt',
        alive.map((item) => item.id),
      )
      return
    }
    if (data === 'del') {
      for (const item of alive) this.itemService.trash(item.id)
      await ctx.answerCallbackQuery()
      await ctx.editMessageText(TEXTS.deleted)
      return
    }
    await ctx.answerCallbackQuery()
  }

  private remember(chatId: number, messageId: number, kind: 'reply' | 'note_prompt', itemIds: string[]) {
    this.db
      .insert(telegramMessages)
      .values({ chatId, messageId, kind, itemIds: JSON.stringify(itemIds), createdAt: Date.now() })
      .onConflictDoNothing()
      .run()
  }

  private mapping(chatId: number, messageId: number, kind: 'reply' | 'note_prompt'): string[] | null {
    const row = this.db
      .select({ itemIds: telegramMessages.itemIds })
      .from(telegramMessages)
      .where(
        and(
          eq(telegramMessages.chatId, chatId),
          eq(telegramMessages.messageId, messageId),
          eq(telegramMessages.kind, kind),
        ),
      )
      .get()
    return row ? (JSON.parse(row.itemIds) as string[]) : null
  }

  // --- commands -------------------------------------------------------------------------------

  private boardList(): string {
    const rows = this.db
      .select({ name: boards.name, hashtag: boards.hashtag })
      .from(boards)
      .where(isNull(boards.deletedAt))
      .orderBy(boards.name)
      .all()
    if (rows.length === 0) return TEXTS.noBoards
    return TEXTS.boards(rows.map((row) => `• ${row.name} – #${row.hashtag}`))
  }

  private inboxSummary(): string {
    const total = this.db.select({ n: count() }).from(items).where(eq(items.status, 'inbox')).get()?.n ?? 0
    const latest = this.itemService.list('inbox', null, null, 5).items
    return TEXTS.inbox(
      total,
      latest.map((item) => `• ${itemLabel(item)}`),
    )
  }
}
