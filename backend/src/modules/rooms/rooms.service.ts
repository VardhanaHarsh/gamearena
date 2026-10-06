import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { pool, withTransaction, isUniqueViolation } from '../../database/pool.js'
import { AppError, Errors } from '../../lib/errors.js'
import { roomCode } from '../../lib/random.js'
import { redis } from '../../redis/client.js'
import { audit } from '../audit/audit.service.js'
import { getEngine } from '../games/registry.js'
import * as ledger from '../ledger/ledger.service.js'
import { assertCanPlay } from '../users/account.guard.js'
import { refundHold } from './settlement.service.js'

export const MAX_ENTRY_FEE = 5000
export const BOT_NAMES = ['Arena Bot Atlas', 'Arena Bot Nova', 'Arena Bot Echo']

export type RoomStatus = 'WAITING' | 'READY' | 'STARTING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export interface RoomRow {
  id: string
  code: string
  game_key: string
  host_id: string
  entry_fee: number
  max_players: number
  is_private: boolean
  is_practice: boolean
  status: RoomStatus
  created_at: string
  started_at: string | null
  ended_at: string | null
}

export interface SeatView {
  seat: number
  userId: string | null
  username: string | null
  displayName: string
  avatar: string
  isBot: boolean
  isReady: boolean
  status: 'JOINED' | 'FORFEITED'
  entryTxId: string | null
}

export async function getRoom(roomId: string, db: pg.Pool | pg.PoolClient = pool) {
  const { rows } = await db.query<RoomRow>('SELECT * FROM game_rooms WHERE id = $1', [roomId])
  return rows[0] ?? null
}

export async function findRoom(idOrCode: string) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrCode)
  const { rows } = await pool.query<RoomRow>(isUuid ? 'SELECT * FROM game_rooms WHERE id = $1' : 'SELECT * FROM game_rooms WHERE code = upper($1)', [idOrCode])
  return rows[0] ?? null
}

export async function getSeats(roomId: string, db: pg.Pool | pg.PoolClient = pool): Promise<SeatView[]> {
  const { rows } = await db.query(
    `SELECT gp.seat, gp.user_id, gp.bot_name, gp.is_ready, gp.status, gp.entry_tx_id, u.username, p.display_name, p.avatar
       FROM game_players gp LEFT JOIN users u ON u.id = gp.user_id LEFT JOIN user_profiles p ON p.user_id = gp.user_id
      WHERE gp.room_id = $1 ORDER BY gp.seat`,
    [roomId],
  )
  return rows.map((r) => ({
    seat: r.seat,
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name ?? r.bot_name,
    avatar: r.avatar ?? 'robot',
    isBot: r.user_id === null,
    isReady: r.is_ready,
    status: r.status,
    entryTxId: r.entry_tx_id,
  }))
}

/** Reserves (HOLDs) the entry fee, enforcing the daily virtual spending limit. */
async function holdEntryFee(client: pg.PoolClient, userId: string, room: Pick<RoomRow, 'id' | 'code' | 'entry_fee' | 'game_key'>) {
  if (room.entry_fee === 0) return null
  const { rows } = await client.query<{ daily_spend_limit: number | null }>('SELECT daily_spend_limit FROM user_settings WHERE user_id = $1', [userId])
  const limit = rows[0]?.daily_spend_limit
  if (limit) {
    const spent = await ledger.spentToday(client, userId)
    if (spent + room.entry_fee > limit) {
      throw new AppError(409, 'DAILY_LIMIT_REACHED', `This would exceed your daily virtual spending limit of ${limit} credits.`)
    }
  }
  const { tx } = await ledger.post(client, {
    userId,
    type: 'ENTRY_FEE',
    kind: 'HOLD',
    amount: room.entry_fee,
    gameId: room.id,
    status: 'PENDING',
    // A fresh key per join attempt: the seat's UNIQUE constraints (same transaction) prevent double joins.
    idempotencyKey: `entry:${room.id}:${userId}:${randomUUID()}`,
    metadata: { roomCode: room.code, game: room.game_key },
  })
  return tx.transaction_id
}

export async function createRoom(userId: string, input: { gameKey: string; entryFee: number; maxPlayers: number; isPrivate: boolean }) {
  const engine = getEngine(input.gameKey)
  if (!engine) throw Errors.notFound('Game')
  if (input.maxPlayers < engine.meta.minPlayers || input.maxPlayers > engine.meta.maxPlayers) {
    throw Errors.badRequest(`${engine.meta.name} supports ${engine.meta.minPlayers}–${engine.meta.maxPlayers} players.`)
  }
  await assertCanPlay(userId)
  const room = await withTransaction(async (client) => {
    await assertNotInActiveRoom(client, userId)
    let created: RoomRow | undefined
    for (let attempt = 0; !created && attempt < 5; attempt++) {
      try {
        await client.query('SAVEPOINT code_attempt')
        const { rows } = await client.query<RoomRow>(
          `INSERT INTO game_rooms (code, game_key, host_id, entry_fee, max_players, is_private) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [roomCode(), input.gameKey, userId, input.entryFee, input.maxPlayers, input.isPrivate],
        )
        created = rows[0]
      } catch (err) {
        if (!isUniqueViolation(err)) throw err
        await client.query('ROLLBACK TO SAVEPOINT code_attempt')
      }
    }
    if (!created) throw new Error('could not allocate a room code')
    const entryTx = await holdEntryFee(client, userId, created)
    await client.query('INSERT INTO game_players (room_id, user_id, seat, entry_tx_id) VALUES ($1, $2, 0, $3)', [created.id, userId, entryTx])
    return created
  })
  await audit({ actorId: userId, action: 'room.created', targetType: 'room', targetId: room.id, details: input })
  return room
}

/** Practice: no entry fee, opponents are server-side bots, starts immediately. */
export async function createPracticeRoom(userId: string, gameKey: string, players: number) {
  const engine = getEngine(gameKey)
  if (!engine) throw Errors.notFound('Game')
  const total = Math.min(Math.max(players, engine.meta.minPlayers), engine.meta.maxPlayers)
  return withTransaction(async (client) => {
    const { rows } = await client.query<RoomRow>(
      `INSERT INTO game_rooms (code, game_key, host_id, entry_fee, max_players, is_private, is_practice) VALUES ($1, $2, $3, 0, $4, true, true) RETURNING *`,
      [roomCode(8), gameKey, userId, total],
    )
    const room = rows[0]
    await client.query('INSERT INTO game_players (room_id, user_id, seat, is_ready) VALUES ($1, $2, 0, true)', [room.id, userId])
    for (let seat = 1; seat < total; seat++) {
      await client.query('INSERT INTO game_players (room_id, bot_name, seat, is_ready) VALUES ($1, $2, $3, true)', [room.id, BOT_NAMES[seat - 1], seat])
    }
    return room
  })
}

async function assertNotInActiveRoom(client: pg.PoolClient, userId: string, exceptRoomId?: string) {
  const { rows } = await client.query<{ id: string; code: string }>(
    `SELECT r.id, r.code FROM game_players gp JOIN game_rooms r ON r.id = gp.room_id
      WHERE gp.user_id = $1 AND gp.status = 'JOINED' AND NOT r.is_practice
        AND r.status IN ('WAITING', 'READY', 'STARTING', 'IN_PROGRESS') AND r.id IS DISTINCT FROM $2 LIMIT 1`,
    [userId, exceptRoomId ?? null],
  )
  if (rows[0]) throw new AppError(409, 'ALREADY_IN_ROOM', `You are already in room ${rows[0].code}. Leave it first.`, { roomId: rows[0].id })
}

/** Joins a room and holds the entry fee atomically. Re-joining a room you are already in is a no-op. */
export async function joinRoom(userId: string, roomId: string) {
  await assertCanPlay(userId)
  return withTransaction(async (client) => {
    const { rows } = await client.query<RoomRow>('SELECT * FROM game_rooms WHERE id = $1 FOR UPDATE', [roomId])
    const room = rows[0]
    if (!room) throw Errors.notFound('Room')
    const seats = await getSeats(roomId, client)
    if (seats.some((s) => s.userId === userId)) return { room, seat: seats.find((s) => s.userId === userId)!.seat, alreadyJoined: true }
    if (room.is_practice) throw Errors.forbidden('Practice rooms are private.')
    if (room.status !== 'WAITING' && room.status !== 'READY') throw new AppError(409, 'GAME_STARTED', 'Game has already started.')
    if (seats.length >= room.max_players) throw new AppError(409, 'ROOM_FULL', 'This room is full.')
    await assertNotInActiveRoom(client, userId, roomId)

    const taken = new Set(seats.map((s) => s.seat))
    let seat = 0
    while (taken.has(seat)) seat++
    const entryTx = await holdEntryFee(client, userId, room)
    await client.query('INSERT INTO game_players (room_id, user_id, seat, entry_tx_id) VALUES ($1, $2, $3, $4)', [roomId, userId, seat, entryTx])
    if (room.status === 'READY') await client.query(`UPDATE game_rooms SET status = 'WAITING' WHERE id = $1`, [roomId])
    await audit({ actorId: userId, action: 'room.joined', targetType: 'room', targetId: roomId, details: { seat } }, client)
    return { room, seat, alreadyJoined: false }
  })
}

/**
 * Leaves a room that has not started: removes the seat and RELEASEs the held entry fee.
 * If the host leaves, host passes to the next player; an empty room is cancelled.
 * (Leaving an in-progress game is a forfeit and is handled by the GameServer.)
 */
export async function leaveWaitingRoom(userId: string, roomId: string) {
  return withTransaction(async (client) => {
    const { rows } = await client.query<RoomRow>('SELECT * FROM game_rooms WHERE id = $1 FOR UPDATE', [roomId])
    const room = rows[0]
    if (!room) throw Errors.notFound('Room')
    if (!['WAITING', 'READY', 'STARTING'].includes(room.status)) throw new AppError(409, 'GAME_STARTED', 'The game has already started.')
    const { rows: mine } = await client.query<{ entry_tx_id: string | null }>('DELETE FROM game_players WHERE room_id = $1 AND user_id = $2 RETURNING entry_tx_id', [roomId, userId])
    if (!mine[0]) throw Errors.badRequest('You are not in this room.')
    if (mine[0].entry_tx_id) await refundHold(client, userId, mine[0].entry_tx_id, room.entry_fee, roomId, 'Left room before start')

    const remaining = await getSeats(roomId, client)
    const humans = remaining.filter((s) => !s.isBot)
    let status: RoomStatus = 'WAITING'
    if (humans.length === 0) {
      status = 'CANCELLED'
      await client.query(`UPDATE game_rooms SET status = 'CANCELLED', ended_at = now() WHERE id = $1`, [roomId])
    } else {
      const newHost = room.host_id === userId ? humans[0].userId! : room.host_id
      await client.query(`UPDATE game_rooms SET status = 'WAITING', host_id = $2 WHERE id = $1`, [roomId, newHost])
      await client.query('UPDATE game_players SET is_ready = false WHERE room_id = $1', [roomId])
    }
    await audit({ actorId: userId, action: 'room.left', targetType: 'room', targetId: roomId }, client)
    return { status, refunded: mine[0].entry_tx_id ? room.entry_fee : 0 }
  })
}

export async function setReady(userId: string, roomId: string, ready: boolean) {
  const { rowCount } = await pool.query(
    `UPDATE game_players gp SET is_ready = $3 FROM game_rooms r
      WHERE gp.room_id = $1 AND gp.user_id = $2 AND r.id = gp.room_id AND r.status IN ('WAITING', 'READY')`,
    [roomId, userId, ready],
  )
  if (!rowCount) throw new AppError(409, 'CANNOT_READY', 'You cannot change ready state now.')
}

export async function setStatus(roomId: string, status: RoomStatus, db: pg.Pool | pg.PoolClient = pool) {
  await db.query(
    `UPDATE game_rooms SET status = $2,
       started_at = CASE WHEN $2 = 'IN_PROGRESS' THEN now() ELSE started_at END
     WHERE id = $1 AND status NOT IN ('COMPLETED', 'CANCELLED')`,
    [roomId, status],
  )
}

export async function markForfeited(roomId: string, seat: number) {
  await pool.query(`UPDATE game_players SET status = 'FORFEITED' WHERE room_id = $1 AND seat = $2`, [roomId, seat])
}

/** Public lobby: open rooms with seat counts. */
export async function listOpenRooms(gameKey?: string) {
  const { rows } = await pool.query(
    `SELECT r.id, r.code, r.game_key, r.entry_fee, r.max_players, r.status, r.created_at,
            count(gp.seat)::int AS players, hp.display_name AS host_name
       FROM game_rooms r
       LEFT JOIN game_players gp ON gp.room_id = r.id
       JOIN user_profiles hp ON hp.user_id = r.host_id
      WHERE NOT r.is_private AND NOT r.is_practice
        AND r.status IN ('WAITING', 'READY', 'STARTING', 'IN_PROGRESS')
        AND ($1::text IS NULL OR r.game_key = $1)
        AND r.created_at > now() - interval '6 hours'
      GROUP BY r.id, hp.display_name
      ORDER BY (r.status IN ('WAITING', 'READY')) DESC, r.created_at DESC
      LIMIT 50`,
    [gameKey ?? null],
  )
  return rows.map((r) => ({ ...r, prize_pool: r.entry_fee * r.max_players }))
}

/**
 * Quick match: joins the oldest open public room for this game & fee, or creates one.
 * A short Redis lock per (game, fee) bucket stops two players from creating two half-empty rooms at once.
 */
export async function quickMatch(userId: string, gameKey: string, entryFee: number) {
  const engine = getEngine(gameKey)
  if (!engine) throw Errors.notFound('Game')
  const lockKey = `ga:mm:lock:${gameKey}:${entryFee}`
  for (let i = 0; i < 20; i++) {
    if (await redis.set(lockKey, userId, 'PX', 3000, 'NX')) break
    await new Promise((r) => setTimeout(r, 100))
  }
  try {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT r.id FROM game_rooms r LEFT JOIN game_players gp ON gp.room_id = r.id
        WHERE r.game_key = $1 AND r.entry_fee = $2 AND r.status IN ('WAITING', 'READY') AND NOT r.is_private AND NOT r.is_practice
        GROUP BY r.id HAVING count(gp.seat) < r.max_players AND bool_and(gp.user_id IS DISTINCT FROM $3)
        ORDER BY r.created_at LIMIT 1`,
      [gameKey, entryFee, userId],
    )
    if (rows[0]) {
      const joined = await joinRoom(userId, rows[0].id)
      return joined.room
    }
    return createRoom(userId, { gameKey, entryFee, maxPlayers: engine.meta.key === 'ludo' ? 4 : engine.meta.maxPlayers, isPrivate: false })
  } finally {
    await redis.del(lockKey)
  }
}
