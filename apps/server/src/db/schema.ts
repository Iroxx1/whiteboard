// SQLite schema (PLAN.md 5.2). IDs are ULIDs, timestamps are UTC milliseconds.
// Tables for later phases (items, jobs, Telegram, e-mail, search) are added with those phases.
import { sql } from 'drizzle-orm'
import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
  (table) => [index('assets_board_idx').on(table.boardId)],
)
