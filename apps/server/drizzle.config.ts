import { defineConfig } from 'drizzle-kit'

// `pnpm --filter @wb/server db:generate` writes a new SQL migration after schema changes.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
})
