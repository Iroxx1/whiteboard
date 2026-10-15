import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const here = path.dirname(fileURLToPath(import.meta.url))

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value)

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, '')),
  APP_NAME: z.string().min(1).max(40).default('Whiteboard'),
  DATA_DIR: z.string().default('/data'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(1000).default(100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Comma-separated IPs/CIDRs of reverse proxies whose X-Forwarded-For / CF-Connecting-IP is trusted.
  TRUSTED_PROXIES: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  WEB_DIST: z.string().default(path.resolve(here, '../../web/dist')),
  MIGRATIONS_DIR: z.string().default(path.resolve(here, '../drizzle')),
  APP_VERSION: z.preprocess(emptyToUndefined, z.string().default('dev')),
  // Inbox address shown in the settings, e.g. board@example.de.
  EMAIL_ADDRESS: z.preprocess(emptyToUndefined, z.email().optional()),
  // Bearer token of the Cloudflare email worker (at least 32 characters); empty = e-mail off (PLAN.md 5.8).
  EMAIL_INGEST_TOKEN: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  // Text recognition in images and scanned PDFs (PLAN.md 5.10).
  OCR_ENABLED: z
    .enum(['true', 'false', '1', '0', ''])
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
  OCR_LANGS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^[a-z_]+(\+[a-z_]+)*$/)
      .default('deu+eng'),
  ),
  // Speech to text for voice messages and audio files via a whisper.cpp server (PLAN.md 5.11).
  TRANSCRIBE_ENABLED: z
    .enum(['true', 'false', '1', '0', ''])
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
  WHISPER_URL: z.preprocess(emptyToUndefined, z.url({ protocol: /^https?$/ }).default('http://whisper:8080/inference')),
  // Model file in ./models (ggml-<name>.bin); shown on the system page, used by compose and the download script.
  WHISPER_MODEL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^[\w.-]+$/)
      .default('small-q5_1'),
  ),
  // Token from @BotFather; empty = Telegram bot off (PLAN.md 5.7).
  TELEGRAM_BOT_TOKEN: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d+:[A-Za-z0-9_-]{20,}$/)
      .optional(),
  ),
})

export type Config = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env)
  if (!result.success) {
    const details = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n')
    throw new Error(`Invalid configuration:\n${details}`)
  }
  return result.data
}
