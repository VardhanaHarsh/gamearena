import { createAdapter } from '@socket.io/redis-adapter'
import type { Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { z } from 'zod'
import { env } from '../config/env.js'
import { pool } from '../database/pool.js'
import { AppError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { verifyAccessToken, type AuthUser } from '../middleware/auth.js'
import { allowEvent } from '../middleware/rateLimit.js'
import { keys, redis } from '../redis/client.js'
import { attachAntiCheatSocket } from '../modules/anticheat/anticheat.service.js'
import { attachNotificationSocket, userRoom } from '../modules/notifications/notification.service.js'
import { gameServer } from './gameServer.js'

/**
 * Client → server events (all acknowledged with `{ ok: true, data } | { ok: false, error }`):
 *   lobby:subscribe, room:join, room:leave, room:ready, room:start, room:invite, game:move, game:sync
 * Server → client events:
 *   room:state, game:start, game:state, game:turn, game:end, player:disconnect, player:reconnect,
 *   notification:new, lobby:update, admin:flag
 */
const roomIdSchema = z.object({ roomId: z.uuid() })
const schemas = {
  'room:join': roomIdSchema,
  'room:leave': roomIdSchema,
  'room:ready': roomIdSchema.extend({ ready: z.boolean() }),
  'room:start': roomIdSchema,
  'room:invite': roomIdSchema.extend({ username: z.string().regex(/^[A-Za-z0-9_]{3,20}$/) }),
  'game:move': roomIdSchema.extend({
    move: z.unknown(), // shape validated by the game engine's own schema
    clientMoveId: z.uuid(),
    clientTs: z.number().int().positive().optional(),
  }),
  'game:sync': roomIdSchema,
} as const
type EventName = keyof typeof schemas

type Ack = (response: { ok: true; data?: unknown } | { ok: false; error: { code: string; message: string } }) => void

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.corsOrigins, credentials: true },
    pingInterval: 10_000,
    pingTimeout: 8_000,
    maxHttpBufferSize: 64 * 1024,
  })

  // Redis adapter: broadcasts reach sockets connected to any backend instance.
  const pub = redis.duplicate()
  const sub = redis.duplicate()
  io.adapter(createAdapter(pub, sub))

  attachNotificationSocket(io)
  attachAntiCheatSocket(io)
  gameServer.attach(io)

  // Handshake authentication — no anonymous sockets.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
      if (typeof token !== 'string') throw new Error('missing token')
      const user = verifyAccessToken(token)
      const { rows } = await pool.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [user.id])
      if (!rows[0] || rows[0].status === 'SUSPENDED') throw new Error('account unavailable')
      socket.data.user = user
      next()
    } catch {
      next(new Error('UNAUTHORIZED'))
    }
  })

  io.on('connection', (socket) => {
    const user = socket.data.user as AuthUser
    void socket.join(userRoom(user.id))
    if (user.role === 'ADMIN') void socket.join('admins')
    void redis.zadd(keys.online, Date.now(), user.id)

    const on = <E extends EventName>(event: E, handler: (data: z.infer<(typeof schemas)[E]>) => Promise<unknown>) => {
      socket.on(event as string, async (raw: unknown, ack?: Ack) => {
        const reply: Ack = typeof ack === 'function' ? ack : () => {}
        try {
          if (!(await allowEvent('ws', user.id, 40, 5))) throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.')
          const parsed = schemas[event].safeParse(raw)
          if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request.')
          reply({ ok: true, data: await handler(parsed.data as z.infer<(typeof schemas)[E]>) })
        } catch (err) {
          if (err instanceof AppError) reply({ ok: false, error: { code: err.code, message: err.message } })
          else {
            logger.error({ err, event, userId: user.id }, 'socket handler failed')
            reply({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong.' } })
          }
        }
      })
    }

    socket.on('lobby:subscribe', () => void socket.join('lobby'))
    socket.on('lobby:unsubscribe', () => void socket.leave('lobby'))
    on('room:join', ({ roomId }) => gameServer.subscribe(socket, user.id, roomId))
    on('room:leave', async ({ roomId }) => {
      const result = await gameServer.leave(user.id, roomId)
      await gameServer.unsubscribe(socket, user.id, roomId)
      return result
    })
    on('room:ready', ({ roomId, ready }) => gameServer.setReady(user.id, roomId, ready))
    on('room:start', ({ roomId }) => gameServer.requestStart(user.id, roomId))
    on('room:invite', ({ roomId, username }) => gameServer.invite(user.id, roomId, username))
    on('game:move', ({ roomId, move, clientMoveId, clientTs }) => gameServer.handleMove(user.id, roomId, { move, clientMoveId, clientTs }))
    on('game:sync', ({ roomId }) => gameServer.getRoomView(roomId))

    socket.on('disconnect', async () => {
      gameServer.socketDisconnected(socket as Socket, user.id)
      const remaining = await io.in(userRoom(user.id)).fetchSockets()
      if (remaining.length === 0) await redis.zrem(keys.online, user.id)
    })
  })

  return io
}
