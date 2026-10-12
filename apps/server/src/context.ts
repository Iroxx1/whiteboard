import type { FastifyBaseLogger as Logger } from 'fastify'
import type { Sessions } from './auth/sessions.ts'
import type { SetupToken } from './auth/setup.ts'
import type { BoardRooms } from './boards/rooms.ts'
import type { Config } from './config.ts'
import type { DbHandle } from './db/index.ts'
import type { ItemService } from './items/service.ts'
import type { JobQueue } from './jobs/queue.ts'
import type { RealtimeHub } from './realtime/hub.ts'

/** Shared services, created once in buildApp and handed to the route modules. */
export type AppContext = {
  config: Config
  log: Logger
  database: DbHandle
  sessions: Sessions
  setup: SetupToken
  rooms: BoardRooms
  hub: RealtimeHub
  items: ItemService
  queue: JobQueue
}
