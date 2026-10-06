import { createServer } from 'node:http'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { migrate } from './database/migrate.js'
import { pool } from './database/pool.js'
import { logger } from './lib/logger.js'
import { redis } from './redis/client.js'
import { gameServer } from './websocket/gameServer.js'
import { createSocketServer } from './websocket/index.js'

async function main() {
  if (process.env.RUN_MIGRATIONS_ON_START !== 'false') await migrate()
  if (env.SEED_ON_START === 'true') await (await import('./database/seed.js')).seed()
  const app = createApp()
  const httpServer = createServer(app)
  const io = createSocketServer(httpServer)
  await gameServer.restore()

  httpServer.listen(env.PORT, () => logger.info(`GameArena API listening on :${env.PORT} (DEMO MODE — virtual credits only)`))

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down')
    gameServer.shutdown()
    io.close()
    httpServer.close()
    await Promise.allSettled([pool.end(), redis.quit()])
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start')
  process.exit(1)
})
