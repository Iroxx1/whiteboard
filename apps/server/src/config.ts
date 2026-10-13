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
