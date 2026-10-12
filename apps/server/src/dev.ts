// Development entry point: sensible defaults so `pnpm dev` works without a .env file.
process.env.NODE_ENV ??= 'development'
process.env.PUBLIC_URL ??= 'http://localhost:5173'
process.env.DATA_DIR ??= new URL('../../../data', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
process.env.LOG_LEVEL ??= 'debug'

await import('./index.ts')
