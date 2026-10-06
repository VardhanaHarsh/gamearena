import type { Server } from 'socket.io'
import { pool, type Db } from '../../database/pool.js'
import { logger } from '../../lib/logger.js'

let io: Server | null = null
export const attachNotificationSocket = (server: Server) => {
  io = server
}

export const userRoom = (userId: string) => `user:${userId}`

export type NotificationType =
  | 'ROOM_PLAYER_JOINED'
  | 'ROOM_INVITE'
  | 'GAME_STARTING'
  | 'GAME_WON'
  | 'GAME_LOST'
  | 'GAME_DRAW'
  | 'PRIZE_CREDITED'
  | 'REFUND'
  | 'PLAYER_DISCONNECTED'
  | 'PLAYER_RECONNECTED'
  | 'WELCOME'
  | 'ACCOUNT'

/** Persists a notification and pushes it in real time over Socket.IO (event `notification:new`). */
export async function notify(userId: string, type: NotificationType, title: string, body: string, data: Record<string, unknown> = {}, db: Db = pool) {
  try {
    const { rows } = await db.query(
      `INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, type, title, body, data, read_at, created_at`,
      [userId, type, title, body, data],
    )
    io?.to(userRoom(userId)).emit('notification:new', rows[0])
    return rows[0]
  } catch (err) {
    logger.error({ err, userId, type }, 'failed to create notification')
  }
}

/** Ephemeral push (not persisted) — for high-frequency, low-value events. */
export function push(userId: string, event: string, payload: unknown) {
  io?.to(userRoom(userId)).emit(event, payload)
}

export async function list(userId: string, limit = 30) {
  const { rows } = await pool.query(
    `SELECT id, type, title, body, data, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  )
  const { rows: unread } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId])
  return { items: rows, unread: unread[0].n }
}

export async function markRead(userId: string, ids?: string[]) {
  if (ids?.length) await pool.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL', [userId, ids])
  else await pool.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId])
}
