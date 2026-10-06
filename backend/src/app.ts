import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env } from './config/env.js'
import { pool } from './database/pool.js'
import { logger } from './lib/logger.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { rateLimit } from './middleware/rateLimit.js'
import { adminRouter } from './modules/admin/admin.routes.js'
import { authRouter } from './modules/auth/auth.routes.js'
import { gamesRouter } from './modules/games/games.routes.js'
import { historyRouter } from './modules/history/history.routes.js'
import { leaderboardRouter } from './modules/leaderboard/leaderboard.routes.js'
import { notificationsRouter } from './modules/notifications/notification.routes.js'
import { roomsRouter } from './modules/rooms/rooms.routes.js'
import { usersRouter } from './modules/users/users.routes.js'
import { walletRouter } from './modules/wallet/wallet.routes.js'
import { redis } from './redis/client.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'wss:', 'ws:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  )
  app.use(cors({ origin: env.corsOrigins, credentials: true }))
  app.use(express.json({ limit: '32kb' }))
  app.use(cookieParser())
  if (!env.isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }))
  app.use('/api', rateLimit('api', 600, 60))

  app.get('/api/health', async (_req, res) => {
    const [db, cache] = await Promise.allSettled([pool.query('SELECT 1'), redis.ping()])
    const ok = db.status === 'fulfilled' && cache.status === 'fulfilled'
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', demoMode: true, currency: 'VIRTUAL_CREDITS' })
  })

  app.use('/api/auth', authRouter)
  app.use('/api/users', usersRouter)
  app.use('/api/games', gamesRouter)
  app.use('/api/rooms', roomsRouter)
  app.use('/api/wallet', walletRouter)
  app.use('/api/leaderboard', leaderboardRouter)
  app.use('/api/history', historyRouter)
  app.use('/api/notifications', notificationsRouter)
  app.use('/api/admin', adminRouter)

  if (env.STATIC_DIR) {
    const dir = resolve(env.STATIC_DIR)
    if (existsSync(join(dir, 'index.html'))) {
      app.use('/assets', express.static(join(dir, 'assets'), { immutable: true, maxAge: '1y' }))
      app.use(express.static(dir, { index: false, maxAge: '1h' }))
      // SPA fallback for client-side routes (never for /api).
      app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => res.sendFile(join(dir, 'index.html')))
    }
  }

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
