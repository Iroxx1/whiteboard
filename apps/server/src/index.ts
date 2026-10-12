import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'

const config = loadConfig()
const app = await buildApp(config)

let shuttingDown = false
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'shutting down')
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, 'error during shutdown')
        process.exit(1)
      },
    )
  })
}

await app.listen({ host: config.HOST, port: config.PORT })
app.log.info({ version: config.APP_VERSION, publicUrl: config.PUBLIC_URL }, 'whiteboard started')
