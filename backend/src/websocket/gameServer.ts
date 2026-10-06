import type { Server, Socket } from 'socket.io'
import { env } from '../config/env.js'
import { pool } from '../database/pool.js'
import { AppError, Errors } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { keys, redis } from '../redis/client.js'
import { AntiCheatService } from '../modules/anticheat/anticheat.service.js'
import { audit } from '../modules/audit/audit.service.js'
import type { BaseState, GameEngine, PlayerRef } from '../modules/games/engine.js'
import { getEngine } from '../modules/games/registry.js'
import { secureRng } from '../modules/games/rng.js'
import { notify } from '../modules/notifications/notification.service.js'
import * as rooms from '../modules/rooms/rooms.service.js'
import { cancelRoom, settleGame, type Settlement } from '../modules/rooms/settlement.service.js'

const COUNTDOWN_MS = 5000
const BOT_DELAY_MS = 550 // bot "thinking" time, added on top of the previous move's animation
const EVICT_AFTER_MS = 10 * 60 * 1000
const SNAPSHOT_TTL_SECONDS = 6 * 3600

interface LiveSeat extends rooms.SeatView {
  connected: boolean
}

interface LiveRoom {
  id: string
  code: string
  gameKey: string
  engine: GameEngine<BaseState, unknown>
  hostId: string
  entryFee: number
  maxPlayers: number
  isPrivate: boolean
  isPractice: boolean
  status: rooms.RoomStatus
  seats: LiveSeat[]
  state: BaseState | null
  seq: number
  turnDeadline: number | null
  countdownEndsAt: number | null
  result: { outcome: string; winnerSeat: number | null; prizePool: number; payouts: Settlement['payouts'] } | null
  connections: Map<string, Set<string>> // userId -> socket ids
  timers: { turn?: NodeJS.Timeout; countdown?: NodeJS.Timeout; evict?: NodeJS.Timeout; grace: Map<number, NodeJS.Timeout> }
  queue: Promise<unknown>
}

export interface MovePayload {
  move: unknown
  clientMoveId: string
  clientTs?: number
}

const channel = (roomId: string) => `room:${roomId}`

/**
 * Authoritative real-time game server.
 *
 * - All game state lives here (in memory, snapshotted to Redis after every change for crash recovery).
 * - Every action for a room runs through a per-room promise queue, so moves are applied strictly one at a time.
 * - Clients only ever send *intents* (roll, move token 2, shot params…). The engine validates and applies them.
 * - When the engine reports a winner, settlement runs in a single DB transaction (see settlement.service.ts).
 */
class GameServer {
  private io: Server | null = null
  private live = new Map<string, LiveRoom>()
  private loading = new Map<string, Promise<LiveRoom | null>>()
  private lobbyTimer: NodeJS.Timeout | null = null

  attach(io: Server) {
    this.io = io
  }

  // ---------------------------------------------------------------- loading & views

  private async load(roomId: string): Promise<LiveRoom | null> {
    const cached = this.live.get(roomId)
    if (cached) return cached
    if (!this.loading.has(roomId)) {
      this.loading.set(
        roomId,
        this.loadFromStorage(roomId).finally(() => this.loading.delete(roomId)),
      )
    }
    return this.loading.get(roomId)!
  }

  private async loadFromStorage(roomId: string): Promise<LiveRoom | null> {
    const row = await rooms.getRoom(roomId)
    if (!row) return null
    const engine = getEngine(row.game_key)
    if (!engine) return null
    const seats = await rooms.getSeats(roomId)
    const room: LiveRoom = {
      id: row.id,
      code: row.code,
      gameKey: row.game_key,
      engine,
      hostId: row.host_id,
      entryFee: row.entry_fee,
      maxPlayers: row.max_players,
      isPrivate: row.is_private,
      isPractice: row.is_practice,
      status: row.status,
      seats: seats.map((s) => ({ ...s, connected: s.isBot })),
      state: null,
      seq: 0,
      turnDeadline: null,
      countdownEndsAt: null,
      result: null,
      connections: new Map(),
      timers: { grace: new Map() },
      queue: Promise.resolve(),
    }
    if (row.status === 'IN_PROGRESS' || row.status === 'STARTING') {
      const snap = await redis.get(keys.roomState(roomId))
      if (snap) {
        const parsed = JSON.parse(snap) as { state: BaseState; seq: number }
        room.state = parsed.state
        room.seq = parsed.seq
        room.status = 'IN_PROGRESS'
      } else if (row.status === 'IN_PROGRESS') {
        // State lost (e.g. Redis flushed): the only safe outcome is to cancel and refund everyone.
        await cancelRoom(roomId, 'Game state could not be recovered')
        room.status = 'CANCELLED'
      }
    }
    if (row.status === 'COMPLETED') {
      const { rows } = await pool.query('SELECT outcome, winner_seat, prize_pool, final_state FROM game_results WHERE room_id = $1', [roomId])
      if (rows[0]) {
        room.state = rows[0].final_state
        room.result = { outcome: rows[0].outcome, winnerSeat: rows[0].winner_seat, prizePool: rows[0].prize_pool, payouts: [] }
      }
    }
    this.live.set(roomId, room)
    if (room.status === 'IN_PROGRESS' && room.state) this.scheduleTurn(room)
    if (room.status === 'STARTING') void this.enqueue(room, () => this.beginGame(room))
    return room
  }

  private roomView(room: LiveRoom) {
    const meta = room.engine.meta
    return {
      id: room.id,
      code: room.code,
      gameKey: room.gameKey,
      gameName: meta.name,
      hostId: room.hostId,
      entryFee: room.entryFee,
      maxPlayers: room.maxPlayers,
      minPlayers: meta.minPlayers,
      prizePool: room.entryFee * room.seats.filter((s) => s.entryTxId).length,
      isPrivate: room.isPrivate,
      isPractice: room.isPractice,
      status: room.status,
      countdownEndsAt: room.countdownEndsAt,
      seats: room.seats.map(({ entryTxId: _e, ...s }) => s),
      result: room.result,
      currency: 'VIRTUAL_CREDITS',
    }
  }

  private gameView(room: LiveRoom) {
    if (!room.state) return null
    return {
      roomId: room.id,
      gameKey: room.gameKey,
      seq: room.seq,
      state: room.engine.getState(room.state, null),
      currentSeat: room.status === 'IN_PROGRESS' ? room.engine.getCurrentSeat(room.state) : null,
      turnDeadline: room.turnDeadline,
      serverTime: Date.now(),
    }
  }

  private broadcastRoom(room: LiveRoom) {
    this.io?.to(channel(room.id)).emit('room:state', this.roomView(room))
    this.scheduleLobbyUpdate()
  }

  private broadcastGame(room: LiveRoom) {
    this.io?.to(channel(room.id)).emit('game:state', this.gameView(room))
  }

  private scheduleLobbyUpdate() {
    if (this.lobbyTimer) return
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null
      this.io?.to('lobby').emit('lobby:update', { at: Date.now() })
    }, 400)
  }

  /** Serializes all work for one room. */
  private enqueue<T>(room: LiveRoom, fn: () => Promise<T>): Promise<T> {
    const run = room.queue.then(fn, fn)
    room.queue = run.catch((err) => logger.error({ err, roomId: room.id }, 'room task failed'))
    return run
  }

  private async snapshot(room: LiveRoom) {
    if (!room.state) return
    await redis.set(keys.roomState(room.id), JSON.stringify({ state: room.state, seq: room.seq }), 'EX', SNAPSHOT_TTL_SECONDS)
  }

  private async refreshSeats(room: LiveRoom) {
    const fresh = await rooms.getSeats(room.id)
    const row = await rooms.getRoom(room.id)
    if (row) {
      room.hostId = row.host_id
      if (room.status !== 'IN_PROGRESS' && room.status !== 'STARTING') room.status = row.status
    }
    room.seats = fresh.map((s) => ({ ...s, connected: s.isBot || (s.userId ? (room.connections.get(s.userId)?.size ?? 0) > 0 : false) }))
  }

  private seatOf(room: LiveRoom, userId: string) {
    return room.seats.find((s) => s.userId === userId)
  }

  // ---------------------------------------------------------------- subscriptions & presence

  /** Subscribes a socket to a room; doubles as the reconnect path. */
  async subscribe(socket: Socket, userId: string, roomId: string) {
    const room = await this.load(roomId)
    if (!room) throw Errors.notFound('Room')
    const seat = this.seatOf(room, userId)
    if (!seat && (room.isPrivate || room.isPractice)) throw Errors.forbidden('This room is private.')
    await socket.join(channel(roomId))
    if (seat) {
      const conns = room.connections.get(userId) ?? new Set()
      const wasConnected = conns.size > 0
      conns.add(socket.id)
      room.connections.set(userId, conns)
      seat.connected = true
      const grace = room.timers.grace.get(seat.seat)
      if (grace) {
        clearTimeout(grace)
        room.timers.grace.delete(seat.seat)
      }
      if (!wasConnected && room.status === 'IN_PROGRESS') {
        this.io?.to(channel(roomId)).emit('player:reconnect', { seat: seat.seat, userId })
        await this.notifyOthers(room, userId, 'PLAYER_RECONNECTED', 'Player reconnected', `${seat.displayName} is back in the game.`)
      }
    }
    socket.emit('room:state', this.roomView(room))
    const game = this.gameView(room)
    if (game) socket.emit('game:state', game)
    this.broadcastRoom(room)
    return this.roomView(room)
  }

  async unsubscribe(socket: Socket, userId: string, roomId: string) {
    await socket.leave(channel(roomId))
    const room = this.live.get(roomId)
    if (room) this.handleConnectionLost(room, userId, socket.id)
  }

  /** Called on socket disconnect for every room channel the socket had joined. */
  socketDisconnected(socket: Socket, userId: string) {
    for (const room of this.live.values()) this.handleConnectionLost(room, userId, socket.id)
  }

  private handleConnectionLost(room: LiveRoom, userId: string, socketId: string) {
    const conns = room.connections.get(userId)
    if (!conns?.delete(socketId) || conns.size > 0) return
    const seat = this.seatOf(room, userId)
    if (!seat) return
    seat.connected = false
    const active = ['WAITING', 'READY', 'STARTING', 'IN_PROGRESS'].includes(room.status)
    if (!active) return
    if (room.status === 'IN_PROGRESS') {
      this.io?.to(channel(room.id)).emit('player:disconnect', { seat: seat.seat, userId, graceSeconds: env.RECONNECT_GRACE_SECONDS })
      void this.notifyOthers(room, userId, 'PLAYER_DISCONNECTED', 'Player disconnected', `${seat.displayName} disconnected. They have ${env.RECONNECT_GRACE_SECONDS}s to reconnect.`)
    }
    this.broadcastRoom(room)
    const timer = setTimeout(() => {
      room.timers.grace.delete(seat.seat)
      void this.enqueue(room, async () => {
        if (seat.connected) return
        if (room.status === 'IN_PROGRESS') await this.forfeit(room, seat.seat, 'disconnect')
        else if (['WAITING', 'READY'].includes(room.status)) await this.leaveInternal(room, userId)
      })
    }, env.RECONNECT_GRACE_SECONDS * 1000)
    room.timers.grace.set(seat.seat, timer)
  }

  // ---------------------------------------------------------------- lobby lifecycle

  /** Call after a REST endpoint changed room membership (create/join). */
  async membershipChanged(roomId: string, joinedUserId?: string) {
    const room = await this.load(roomId)
    if (!room) return
    await this.enqueue(room, async () => {
      await this.refreshSeats(room)
      if (joinedUserId) {
        const seat = this.seatOf(room, joinedUserId)
        if (seat) await this.notifyOthers(room, joinedUserId, 'ROOM_PLAYER_JOINED', 'Player joined your room', `${seat.displayName} joined room ${room.code}.`, { roomId: room.id })
      }
      await this.evaluateReady(room)
      this.broadcastRoom(room)
    })
  }

  async setReady(userId: string, roomId: string, ready: boolean) {
    const room = await this.requireRoom(roomId)
    return this.enqueue(room, async () => {
      if (!this.seatOf(room, userId)) throw Errors.forbidden('You are not in this room.')
      await rooms.setReady(userId, roomId, ready)
      await this.refreshSeats(room)
      await this.evaluateReady(room)
      this.broadcastRoom(room)
      return this.roomView(room)
    })
  }

  /** WAITING ⇄ READY; a full room where everyone is ready starts automatically. */
  private async evaluateReady(room: LiveRoom) {
    if (room.status !== 'WAITING' && room.status !== 'READY') return
    const allReady = room.seats.length >= room.engine.meta.minPlayers && room.seats.every((s) => s.isReady)
    const next = allReady ? 'READY' : 'WAITING'
    if (next !== room.status) {
      room.status = next
      await rooms.setStatus(room.id, next)
    }
    if (allReady && (room.seats.length === room.maxPlayers || room.isPractice)) await this.startCountdown(room)
  }

  async requestStart(userId: string, roomId: string) {
    const room = await this.requireRoom(roomId)
    return this.enqueue(room, async () => {
      if (room.hostId !== userId) throw Errors.forbidden('Only the host can start the game.')
      if (room.status !== 'READY') throw new AppError(409, 'NOT_READY', 'All players must be ready (and the minimum player count reached).')
      await this.startCountdown(room)
      return this.roomView(room)
    })
  }

  private async startCountdown(room: LiveRoom) {
    if (room.status === 'STARTING' || room.status === 'IN_PROGRESS') return
    room.status = 'STARTING'
    room.countdownEndsAt = Date.now() + COUNTDOWN_MS
    await rooms.setStatus(room.id, 'STARTING')
    this.broadcastRoom(room)
    for (const s of room.seats) {
      if (s.userId) await notify(s.userId, 'GAME_STARTING', 'Game starting in 5 seconds', `${room.engine.meta.name} · room ${room.code}`, { roomId: room.id })
    }
    room.timers.countdown = setTimeout(() => void this.enqueue(room, () => this.beginGame(room)), COUNTDOWN_MS)
  }

  private async beginGame(room: LiveRoom) {
    if (room.status !== 'STARTING') return
    await this.refreshSeats(room)
    room.countdownEndsAt = null
    if (room.seats.length < room.engine.meta.minPlayers) {
      room.status = 'WAITING'
      await rooms.setStatus(room.id, 'WAITING')
      this.broadcastRoom(room)
      return
    }
    // Re-number seats densely in seat order so engines always get 0..n-1.
    const players: PlayerRef[] = room.seats.map((s, i) => ({ seat: i, userId: s.userId, name: s.displayName, isBot: s.isBot }))
    if (room.seats.some((s, i) => s.seat !== i)) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        for (const [i, s] of room.seats.entries()) await client.query('UPDATE game_players SET seat = $3 WHERE room_id = $1 AND seat = $2', [room.id, s.seat, 100 + i])
        await client.query('UPDATE game_players SET seat = seat - 100 WHERE room_id = $1 AND seat >= 100', [room.id])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
      room.seats.forEach((s, i) => (s.seat = i))
    }
    room.state = room.engine.createGame(players, secureRng)
    room.seq = 0
    room.status = 'IN_PROGRESS'
    await rooms.setStatus(room.id, 'IN_PROGRESS')
    await this.snapshot(room)
    await audit({ action: 'game.started', targetType: 'room', targetId: room.id, details: { game: room.gameKey, players: players.length } })
    this.io?.to(channel(room.id)).emit('game:start', { roomId: room.id, players })
    this.broadcastRoom(room)
    this.scheduleTurn(room)
    this.broadcastGame(room)
  }

  async leave(userId: string, roomId: string) {
    const room = await this.requireRoom(roomId)
    return this.enqueue(room, () => this.leaveInternal(room, userId))
  }

  private async leaveInternal(room: LiveRoom, userId: string) {
    const seat = this.seatOf(room, userId)
    if (!seat) throw Errors.badRequest('You are not in this room.')
    if (room.status === 'IN_PROGRESS') {
      await this.forfeit(room, seat.seat, 'left')
      return { forfeited: true, refunded: 0 }
    }
    if (room.status === 'STARTING') {
      clearTimeout(room.timers.countdown)
      room.countdownEndsAt = null
      room.status = 'WAITING'
    }
    const result = await rooms.leaveWaitingRoom(userId, room.id)
    room.status = result.status
    room.connections.delete(userId)
    await this.refreshSeats(room)
    this.broadcastRoom(room)
    return { forfeited: false, refunded: result.refunded }
  }

  async invite(fromUserId: string, roomId: string, username: string) {
    const room = await this.requireRoom(roomId)
    if (!this.seatOf(room, fromUserId)) throw Errors.forbidden('Only players in the room can invite.')
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [username])
    if (!rows[0]) throw Errors.notFound('Player')
    const from = this.seatOf(room, fromUserId)!
    await notify(rows[0].id, 'ROOM_INVITE', 'Game invite', `${from.displayName} invited you to ${room.engine.meta.name} (room ${room.code}, entry ${room.entryFee} virtual credits).`, {
      roomId: room.id,
      code: room.code,
    })
  }

  // ---------------------------------------------------------------- gameplay

  async handleMove(userId: string, roomId: string, payload: MovePayload) {
    const room = await this.requireRoom(roomId)
    return this.enqueue(room, async () => {
      if (room.status !== 'IN_PROGRESS' || !room.state) throw new AppError(409, 'GAME_NOT_ACTIVE', 'The game is not in progress.')
      const seat = this.seatOf(room, userId)
      if (!seat || room.state.forfeited.includes(seat.seat)) throw Errors.forbidden('You are not playing in this game.')
      const ctx = { userId, roomId, clientMoveId: payload.clientMoveId, clientTs: payload.clientTs }

      const preReject = await AntiCheatService.validateMove(ctx)
      if (preReject) throw new AppError(429, 'MOVE_REJECTED', preReject)

      const verdict = room.engine.validateMove(room.state, seat.seat, payload.move)
      if (!verdict.ok) {
        await AntiCheatService.recordInvalidMove(ctx, verdict.reason, verdict.suspicious ?? false, payload.move)
        throw new AppError(422, 'INVALID_MOVE', verdict.reason)
      }
      await this.apply(room, seat.seat, verdict.move, { userId, clientMoveId: payload.clientMoveId })
      return { seq: room.seq }
    })
  }

  private async apply(room: LiveRoom, seat: number, move: unknown, meta: { userId: string | null; clientMoveId?: string; auto?: boolean }) {
    room.state = room.engine.applyMove(room.state!, seat, move, secureRng)
    room.seq++
    pool
      .query('INSERT INTO game_moves (room_id, seq, user_id, seat, move, client_move_id) VALUES ($1, $2, $3, $4, $5, $6)', [
        room.id,
        room.seq,
        meta.userId,
        seat,
        { ...(move as object), ...(meta.auto ? { auto: true } : {}) },
        meta.clientMoveId ?? null,
      ])
      .catch((err) => logger.error({ err, roomId: room.id }, 'failed to persist move'))
    await this.snapshot(room)
    const winner = room.engine.getWinner(room.state)
    if (winner.finished) {
      clearTimeout(room.timers.turn)
      room.turnDeadline = null
      this.broadcastGame(room)
      await this.finish(room)
    } else {
      this.scheduleTurn(room)
      this.broadcastGame(room)
    }
  }

  private scheduleTurn(room: LiveRoom) {
    clearTimeout(room.timers.turn)
    if (!room.state || room.status !== 'IN_PROGRESS') return
    const seatNo = room.engine.getCurrentSeat(room.state)
    if (seatNo === null) return
    const seat = room.seats[seatNo]
    // Let every client finish animating the previous move before the next turn's clock starts.
    const animation = Math.min(room.engine.animationMs?.(room.state) ?? 0, 20_000)
    const delay = animation + (seat?.isBot ? BOT_DELAY_MS : env.TURN_SECONDS * 1000)
    room.turnDeadline = seat?.isBot ? null : Date.now() + delay
    this.io?.to(channel(room.id)).emit('game:turn', { roomId: room.id, seat: seatNo, deadline: room.turnDeadline, serverTime: Date.now() })
    room.timers.turn = setTimeout(() => void this.enqueue(room, () => this.autoPlay(room, seatNo)), delay)
  }

  /** Plays for a bot, or for a human whose turn timer expired. */
  private async autoPlay(room: LiveRoom, seat: number) {
    if (!room.state || room.status !== 'IN_PROGRESS' || room.engine.getCurrentSeat(room.state) !== seat) return
    for (let attempt = 0; attempt < 6; attempt++) {
      const move = room.engine.autoMove(room.state, seat, secureRng)
      if (move === null) break
      const verdict = room.engine.validateMove(room.state, seat, move)
      if (verdict.ok) {
        await this.apply(room, seat, verdict.move, { userId: room.seats[seat]?.userId ?? null, auto: !room.seats[seat]?.isBot })
        return
      }
    }
    logger.warn({ roomId: room.id, seat }, 'auto-move failed; forfeiting seat')
    await this.forfeit(room, seat, 'no-legal-auto-move')
  }

  private async forfeit(room: LiveRoom, seat: number, reason: string) {
    if (!room.state || room.state.forfeited.includes(seat)) return
    room.state = room.engine.endGame(room.state, seat)
    await rooms.markForfeited(room.id, seat)
    const s = room.seats[seat]
    if (s) s.status = 'FORFEITED'
    await audit({ actorId: s?.userId ?? null, action: 'game.forfeit', targetType: 'room', targetId: room.id, details: { seat, reason } })
    await this.snapshot(room)
    const winner = room.engine.getWinner(room.state)
    this.broadcastRoom(room)
    if (winner.finished) {
      clearTimeout(room.timers.turn)
      this.broadcastGame(room)
      await this.finish(room)
    } else {
      this.scheduleTurn(room)
      this.broadcastGame(room)
    }
  }

  private async finish(room: LiveRoom, attempt = 1): Promise<void> {
    const winner = room.engine.getWinner(room.state!)
    if (!winner.finished) return
    let settlement: Settlement
    try {
      settlement = await settleGame({ roomId: room.id, outcome: winner.outcome, winnerSeat: winner.winnerSeat, finalState: room.state })
    } catch (err) {
      logger.error({ err, roomId: room.id, attempt }, 'settlement failed')
      await audit({ action: 'game.settlement_failed', level: 'ERROR', targetType: 'room', targetId: room.id, details: { attempt, message: (err as Error).message } })
      // Settlement is idempotent, so retrying is always safe.
      if (attempt < 3) setTimeout(() => void this.enqueue(room, () => this.finish(room, attempt + 1)), 2000 * attempt)
      return
    }
    room.status = 'COMPLETED'
    room.turnDeadline = null
    room.result = { outcome: winner.outcome, winnerSeat: winner.winnerSeat, prizePool: settlement.prizePool, payouts: settlement.payouts }
    room.timers.grace.forEach(clearTimeout)
    room.timers.grace.clear()
    await redis.del(keys.roomState(room.id))

    this.io?.to(channel(room.id)).emit('game:end', { roomId: room.id, ...room.result, alreadySettled: settlement.alreadySettled })
    this.broadcastRoom(room)

    if (!settlement.alreadySettled) {
      for (const s of room.seats) {
        if (!s.userId) continue
        const payout = settlement.payouts.find((p) => p.userId === s.userId)
        if (winner.outcome === 'DRAW') await notify(s.userId, 'GAME_DRAW', 'It’s a draw', `${room.engine.meta.name} ended in a draw.`, { roomId: room.id })
        else if (winner.winnerSeat === s.seat) await notify(s.userId, 'GAME_WON', 'You won the match!', `You won ${room.engine.meta.name} (room ${room.code}).`, { roomId: room.id })
        else await notify(s.userId, 'GAME_LOST', 'Match finished', `${room.seats[winner.winnerSeat!]?.displayName ?? 'Another player'} won ${room.engine.meta.name}.`, { roomId: room.id })
        if (payout) await notify(s.userId, 'PRIZE_CREDITED', 'Your virtual prize has been credited', `${payout.amount} virtual credits were added to your wallet.`, { roomId: room.id, amount: payout.amount })
      }
    }
    room.timers.evict = setTimeout(() => this.live.delete(room.id), EVICT_AFTER_MS)
  }

  // ---------------------------------------------------------------- admin & helpers

  async adminCancel(roomId: string, adminId: string) {
    const room = await this.requireRoom(roomId)
    return this.enqueue(room, async () => {
      if (room.status === 'COMPLETED' || room.status === 'CANCELLED') throw new AppError(409, 'ROOM_CLOSED', 'Room already closed.')
      clearTimeout(room.timers.turn)
      clearTimeout(room.timers.countdown)
      const { refunded } = await cancelRoom(room.id, 'Cancelled by admin', adminId)
      room.status = 'CANCELLED'
      room.turnDeadline = null
      await redis.del(keys.roomState(room.id))
      for (const userId of refunded) await notify(userId, 'REFUND', 'Room cancelled — entry refunded', `Room ${room.code} was cancelled and your entry fee was returned.`, { roomId })
      this.broadcastRoom(room)
      return { refunded: refunded.length }
    })
  }

  async getRoomView(roomId: string) {
    const room = await this.load(roomId)
    if (!room) throw Errors.notFound('Room')
    return { room: this.roomView(room), game: this.gameView(room) }
  }

  private async requireRoom(roomId: string) {
    const room = await this.load(roomId)
    if (!room) throw Errors.notFound('Room')
    return room
  }

  private async notifyOthers(room: LiveRoom, userId: string, type: Parameters<typeof notify>[1], title: string, body: string, data: Record<string, unknown> = { roomId: room.id }) {
    for (const s of room.seats) if (s.userId && s.userId !== userId) await notify(s.userId, type, title, body, data)
  }

  liveCounts() {
    const playersByGame: Record<string, number> = {}
    const openRoomsByGame: Record<string, number> = {}
    for (const r of this.live.values()) {
      if (['WAITING', 'READY', 'STARTING', 'IN_PROGRESS'].includes(r.status)) {
        playersByGame[r.gameKey] = (playersByGame[r.gameKey] ?? 0) + r.seats.filter((s) => !s.isBot && s.connected).length
      }
      if (!r.isPrivate && !r.isPractice && ['WAITING', 'READY'].includes(r.status)) openRoomsByGame[r.gameKey] = (openRoomsByGame[r.gameKey] ?? 0) + 1
    }
    return { playersByGame, openRoomsByGame }
  }

  /** Admin room monitor. */
  monitor() {
    return [...this.live.values()]
      .filter((r) => r.status !== 'COMPLETED' && r.status !== 'CANCELLED')
      .map((r) => ({ ...this.roomView(r), seq: r.seq, turnDeadline: r.turnDeadline, connected: r.seats.filter((s) => s.connected).length }))
  }

  /** On boot: resume games that were running when the process stopped (state from Redis), else refund. */
  async restore() {
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM game_rooms WHERE status IN ('STARTING', 'IN_PROGRESS')`)
    for (const r of rows) await this.load(r.id)
    if (rows.length) logger.info({ count: rows.length }, 'restored active rooms')
  }

  shutdown() {
    for (const r of this.live.values()) {
      clearTimeout(r.timers.turn)
      clearTimeout(r.timers.countdown)
      clearTimeout(r.timers.evict)
      r.timers.grace.forEach(clearTimeout)
    }
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer)
    this.live.clear()
  }
}

export const gameServer = new GameServer()
