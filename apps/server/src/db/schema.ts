// SQLite schema (PLAN.md 5.2). IDs are ULIDs, timestamps are UTC milliseconds.
// Tables for later phases (items, jobs, Telegram, e-mail, search) are added with those phases.
import { sql } from 'drizzle-orm'
import { blob, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull(),
  theme: text('theme', { enum: ['system', 'light', 'dark'] })
    .notNull()
    .default('system'),
  createdAt: integer('created_at').notNull(),
  disabledAt: integer('disabled_at'),
})

export const sessions = sqliteTable(
  'sessions',
  {
    // SHA-256 of the cookie token; the token itself is never stored.
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
)

export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  role: text('role', { enum: ['admin', 'member'] }).notNull(),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
  usedBy: text('used_by').references(() => users.id, { onDelete: 'set null' }),
})

export const passwordResets = sqliteTable('password_resets', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
})

export const boards = sqliteTable(
  'boards',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    hashtag: text('hashtag').notNull().unique(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    // Not in PLAN.md 5.2, needed for "last changed by" on the dashboard (PLAN.md 4.6).
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: integer('deleted_at'),
    version: integer('version').notNull().default(0),
    // Elements including deleted ones (tombstones), sorted by fractional index.
    elementsJson: text('elements_json').notNull().default('[]'),
    appStateJson: text('app_state_json').notNull().default('{}'),
    inboxFrameId: text('inbox_frame_id'),
  },
  (table) => [index('boards_deleted_idx').on(table.deletedAt)],
)

export const boardSnapshots = sqliteTable(
  'board_snapshots',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason', { enum: ['auto', 'manual', 'before_restore'] }).notNull(),
    elementCount: integer('element_count').notNull(),
    // gzip-compressed JSON: { elements, appState }
    elementsGz: blob('elements_gz', { mode: 'buffer' }).notNull(),
  },
  (table) => [index('board_snapshots_board_idx').on(table.boardId, table.createdAt)],
)

export const assets = sqliteTable(
  'assets',
  {
    // For board images this is Excalidraw's fileId.
    id: text('id').primaryKey(),
    itemId: text('item_id'),
    boardId: text('board_id').references(() => boards.id, { onDelete: 'set null' }),
    role: text('role', {
      enum: ['original', 'display', 'thumb', 'og_image', 'favicon', 'poster', 'page1', 'board_file'],
    }).notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    sha256: text('sha256').notNull(),
    // Relative to DATA_DIR/files.
    path: text('path').notNull(),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index('assets_board_idx').on(table.boardId), index('assets_item_idx').on(table.itemId)],
)

// --- Phase 2: inbox items, processing jobs (PLAN.md 5.2, 5.5) ---

export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    source: text('source', { enum: ['pwa', 'telegram', 'email', 'web'] }).notNull(),
    kind: text('kind', { enum: ['note', 'link', 'image', 'pdf', 'document', 'audio', 'video', 'file'] }).notNull(),
    status: text('status', { enum: ['inbox', 'placed', 'archived', 'trashed'] })
      .notNull()
      .default('inbox'),
    title: text('title'),
    note: text('note'),
    url: text('url'),
    urlNormalized: text('url_normalized'),
    groupId: text('group_id'),
    targetBoardId: text('target_board_id').references(() => boards.id, { onDelete: 'set null' }),
    leaseOwner: text('lease_owner'),
    leaseUntil: integer('lease_until'),
    processing: text('processing', { enum: ['pending', 'ready', 'failed'] })
      .notNull()
      .default('pending'),
    processingError: text('processing_error'),
    // Kind-specific metadata, see ItemMeta in @wb/shared.
    metaJson: text('meta_json').notNull().default('{}'),
    updatedAt: integer('updated_at').notNull(),
    trashedAt: integer('trashed_at'),
    // Status before moving to the trash, so "restore" puts it back where it was.
    statusBeforeTrash: text('status_before_trash', { enum: ['inbox', 'placed', 'archived'] }),
  },
  (table) => [
    index('items_status_idx').on(table.status, table.createdAt),
    index('items_url_idx').on(table.urlNormalized),
    index('items_group_idx').on(table.groupId),
    index('items_target_idx').on(table.targetBoardId),
  ],
)

export const itemPlacements = sqliteTable(
  'item_placements',
  {
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    elementId: text('element_id').notNull(),
    placedAt: integer('placed_at').notNull(),
    placedBy: text('placed_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    uniqueIndex('item_placements_unique').on(table.boardId, table.elementId),
    index('item_placements_item_idx').on(table.itemId),
  ],
)

export const itemTexts = sqliteTable(
  'item_texts',
  {
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['article', 'pdf', 'ocr', 'transcript', 'doc'] }).notNull(),
    text: text('text').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [uniqueIndex('item_texts_unique').on(table.itemId, table.kind)],
)

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull(),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] })
      .notNull()
      .default('queued'),
    priority: integer('priority').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAfter: integer('run_after').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    lastError: text('last_error'),
  },
  (table) => [index('jobs_status_idx').on(table.status, table.runAfter)],
)

// --- Phase 3: idempotent PWA uploads (PLAN.md 5.2, 5.6) ---

export const shareRequests = sqliteTable('share_requests', {
  clientShareId: text('client_share_id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // { "text": [...ids], "0": [...ids], "1": [...] } – items created per step, for repeated requests.
  itemIds: text('item_ids').notNull().default('{}'),
  groupId: text('group_id').notNull(),
  // Note (URLs and hashtags removed) for the first file, resolved target board, file count.
  note: text('note'),
  title: text('title'),
  targetBoardId: text('target_board_id'),
  fileCount: integer('file_count').notNull().default(0),
  createdAt: integer('created_at').notNull(),
})

// --- Phase 4: Telegram bot (PLAN.md 5.2, 5.7) ---

export const telegramLinks = sqliteTable('telegram_links', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  telegramUserId: integer('telegram_user_id').notNull().unique(),
  username: text('username'),
  linkedAt: integer('linked_at').notNull(),
})

export const telegramLinkCodes = sqliteTable('telegram_link_codes', {
  // SHA-256 of the one-time code from the deep link.
  codeHash: text('code_hash').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
})

export const telegramMessages = sqliteTable(
  'telegram_messages',
  {
    chatId: integer('chat_id').notNull(),
    messageId: integer('message_id').notNull(),
    // 'reply' = the bot's answer with buttons, 'note_prompt' = "send me the note" (force_reply).
    kind: text('kind', { enum: ['reply', 'note_prompt'] })
      .notNull()
      .default('reply'),
    itemIds: text('item_ids').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [uniqueIndex('telegram_messages_unique').on(table.chatId, table.messageId)],
)

// --- Phase 5: e-mail via Cloudflare Email Routing (PLAN.md 5.2, 5.8) ---

export const userSenders = sqliteTable(
  'user_senders',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // As entered (shown in the settings).
    email: text('email').notNull(),
    // Lower case; for Gmail without dots and +suffix (PLAN.md 5.8, step 4).
    emailNormalized: text('email_normalized').notNull().unique(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('user_senders_user_idx').on(table.userId)],
)

export const inboundEmails = sqliteTable(
  'inbound_emails',
  {
    id: text('id').primaryKey(),
    receivedAt: integer('received_at').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    messageId: text('message_id'),
    // Relative to DATA_DIR/inbound; null for rejected mails (not stored).
    path: text('path'),
    size: integer('size').notNull(),
    status: text('status', { enum: ['queued', 'done', 'empty', 'failed', 'rejected'] }).notNull(),
    // Why a mail was rejected or failed (never the content).
    reason: text('reason'),
    itemIds: text('item_ids').notNull().default('[]'),
  },
  (table) => [
    index('inbound_emails_message_idx').on(table.messageId),
    index('inbound_emails_received_idx').on(table.receivedAt),
  ],
)
