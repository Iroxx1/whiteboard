import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const here = path.dirname(fileURLToPath(import.meta.url))

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value)

const schema = z
  .object({
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
    // Phase 0 only: shared key that unlocks the spike endpoints until real accounts exist (Phase 1).
    SPIKE_ACCESS_KEY: z.preprocess(emptyToUndefined, z.string().min(24).optional()),
    WEB_DIST: z.string().default(path.resolve(here, '../../web/dist')),
    APP_VERSION: z.string().default('dev'),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV === 'production' && !config.SPIKE_ACCESS_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['SPIKE_ACCESS_KEY'],
        message: 'is required in production (at least 24 characters)',
      })
    }
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
