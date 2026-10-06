import type { Server } from 'socket.io'
import { pool } from '../../database/pool.js'
import { logger } from '../../lib/logger.js'
import { allowEvent } from '../../middleware/rateLimit.js'
import { redis } from '../../redis/client.js'
import { audit } from '../audit/audit.service.js'

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH'
export type FlagReason =
  | 'IMPOSSIBLE_MOVE'
  | 'INVALID_DICE_VALUE'
  | 'DUPLICATE_MOVE'
  | 'RAPID_REQUESTS'
  | 'CLIENT_CLOCK_MANIPULATION'
  | 'ABNORMAL_BEHAVIOR'

const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000
const MOVE_RATE = { limit: 10, windowSeconds: 3 }
const INVALID_MOVES_BEFORE_FLAG = 5

let io: Server | null = null
export const attachAntiCheatSocket = (server: Server) => {
  io = server
}

export interface MoveContext {
  userId: string
  roomId: string
  clientMoveId: string
  clientTs?: number
}

/**
 * Lightweight, non-invasive anti-cheat. It only inspects the game actions a player sends us —
 * no device fingerprinting or client surveillance. Game legality itself is enforced by the engines;
 * this service watches for *patterns* around those actions.
 */
export const AntiCheatService = {
  /** Pre-checks before a move reaches the engine. Returns a rejection reason, or null to proceed. */
  async validateMove(ctx: MoveContext): Promise<string | null> {
    if (!(await allowEvent('move', ctx.userId, MOVE_RATE.limit, MOVE_RATE.windowSeconds))) {
      await this.flagPlayer(ctx.userId, ctx.roomId, 'RAPID_REQUESTS', 'MEDIUM', { window: MOVE_RATE })
      return 'You are sending moves too quickly.'
    }
    // Replay protection: each client move id is accepted once per room.
    const fresh = await redis.set(`ga:mv:${ctx.roomId}:${ctx.clientMoveId}`, '1', 'EX', 6 * 3600, 'NX')
    if (!fresh) {
      await this.flagPlayer(ctx.userId, ctx.roomId, 'DUPLICATE_MOVE', 'LOW', { clientMoveId: ctx.clientMoveId })
      return 'Duplicate move ignored.'
    }
    // The server clock is authoritative; a wildly skewed client timestamp is recorded, not trusted.
    if (ctx.clientTs !== undefined && Math.abs(Date.now() - ctx.clientTs) > MAX_CLOCK_SKEW_MS) {
      await this.flagPlayer(ctx.userId, ctx.roomId, 'CLIENT_CLOCK_MANIPULATION', 'LOW', { skewMs: Date.now() - ctx.clientTs })
    }
    return null
  },

  /** Called when an engine rejects a move. Suspicious rejections (impossible moves, injected dice) are flagged. */
  async recordInvalidMove(ctx: MoveContext, reason: string, suspicious: boolean, rawMove: unknown) {
    const key = `ga:invalid:${ctx.roomId}:${ctx.userId}`
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, 6 * 3600)
    if (suspicious) {
      const injectedDice = typeof rawMove === 'object' && rawMove !== null && ('dice' in rawMove || 'value' in rawMove)
      await this.flagPlayer(ctx.userId, ctx.roomId, injectedDice ? 'INVALID_DICE_VALUE' : 'IMPOSSIBLE_MOVE', injectedDice ? 'HIGH' : 'MEDIUM', { reason, move: rawMove })
    }
    if (count === INVALID_MOVES_BEFORE_FLAG) {
      await this.flagPlayer(ctx.userId, ctx.roomId, 'ABNORMAL_BEHAVIOR', 'HIGH', { invalidMovesThisGame: count })
    }
  },

  /** Summarises recent flags for a player (used by the admin dashboard). */
  async detectSuspiciousActivity(userId: string) {
    const { rows } = await pool.query<{ reason: string; severity: Severity; n: number }>(
      `SELECT reason, severity, count(*)::int AS n FROM anticheat_flags
        WHERE user_id = $1 AND created_at > now() - interval '7 days' GROUP BY reason, severity`,
      [userId],
    )
    const score = rows.reduce((s, r) => s + r.n * (r.severity === 'HIGH' ? 5 : r.severity === 'MEDIUM' ? 2 : 1), 0)
    return { userId, riskScore: score, suspicious: score >= 10, breakdown: rows }
  },

  async flagPlayer(userId: string, roomId: string | null, reason: FlagReason, severity: Severity, details: Record<string, unknown> = {}) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO anticheat_flags (user_id, room_id, reason, severity, details) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [userId, roomId, reason, severity, details],
      )
      await audit({ actorId: userId, action: 'anticheat.flag', level: severity === 'HIGH' ? 'WARN' : 'INFO', targetType: 'room', targetId: roomId ?? undefined, details: { reason, severity } })
      io?.to('admins').emit('admin:flag', rows[0])
    } catch (err) {
      logger.error({ err }, 'failed to record anti-cheat flag')
    }
  },
}
