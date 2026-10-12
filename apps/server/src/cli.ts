// Maintenance commands for the server shell (docs/BETRIEB.md):
//   node apps/server/dist/cli.js reset-link <email>
// Prints a one-time password reset link (24 h), e.g. when the only admin forgot the password.
import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { RESET_LIFETIME_MS } from './admin/routes.ts'
import { loadConfig } from './config.ts'
import { openDatabase } from './db/index.ts'
import { passwordResets, users } from './db/schema.ts'
import { randomToken, sha256 } from './lib/tokens.ts'

const quiet = { info() {}, warn() {}, error() {} } as unknown as FastifyBaseLogger

async function main(args: string[]) {
  const [command, email] = args
  if (command !== 'reset-link' || !email) {
    console.error('Usage: node apps/server/dist/cli.js reset-link <email>')
    return 2
  }
  const config = loadConfig()
  const { db, sqlite } = await openDatabase(config.DATA_DIR, config.MIGRATIONS_DIR, quiet)
  try {
    const user = db
      .select({ id: users.id, disabledAt: users.disabledAt })
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .get()
    if (!user) {
      console.error('No account with this e-mail address.')
      return 1
    }
    if (user.disabledAt) db.update(users).set({ disabledAt: null }).where(eq(users.id, user.id)).run()
    const token = randomToken()
    const now = Date.now()
    db.delete(passwordResets)
      .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)))
      .run()
    db.insert(passwordResets)
      .values({
        tokenHash: sha256(token),
        userId: user.id,
        createdBy: null,
        createdAt: now,
        expiresAt: now + RESET_LIFETIME_MS,
      })
      .run()
    console.log(`${config.PUBLIC_URL}/reset/${token}`)
    if (user.disabledAt) console.error('Note: the account was disabled and has been enabled again.')
    return 0
  } finally {
    sqlite.close()
  }
}

process.exitCode = await main(process.argv.slice(2))
