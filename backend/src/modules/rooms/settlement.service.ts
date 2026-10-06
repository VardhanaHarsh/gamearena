import type pg from 'pg'
import { withTransaction } from '../../database/pool.js'
import { audit } from '../audit/audit.service.js'
import * as ledger from '../ledger/ledger.service.js'
import { invalidate } from '../../redis/client.js'

export interface SettlementInput {
  roomId: string
  outcome: 'WIN' | 'DRAW' | 'FORFEIT'
  winnerSeat: number | null
  finalState: unknown
}

export interface Settlement {
  alreadySettled: boolean
  resultId?: string
  prizePool: number
  payouts: { userId: string; seat: number; amount: number }[]
  winnerUserId: string | null
}

interface SeatRow {
  seat: number
  user_id: string | null
  entry_tx_id: string | null
}

const XP = { play: 10, win: 40, practice: 2 }

/**
 * Settles a finished game exactly once.
 *
 *   validate result → lock room → insert game_results (UNIQUE room_id) → capture entry holds
 *   → credit prize(s) → update leaderboards/XP → mark room COMPLETED
 *
 * Every step runs in ONE database transaction. Double settlement is impossible because:
 *   1. the room row is locked FOR UPDATE and a COMPLETED room returns early;
 *   2. game_results.room_id is UNIQUE (INSERT … ON CONFLICT DO NOTHING);
 *   3. every ledger line uses a deterministic idempotency key (capture:<hold>, prize:<room>:<user>).
 */
export async function settleGame(input: SettlementInput): Promise<Settlement> {
  const result = await withTransaction(async (client) => {
    const { rows: rooms } = await client.query('SELECT * FROM game_rooms WHERE id = $1 FOR UPDATE', [input.roomId])
    const room = rooms[0]
    if (!room) throw new Error(`room ${input.roomId} not found`)
    if (room.status === 'COMPLETED' || room.status === 'CANCELLED') {
      return { alreadySettled: true, prizePool: 0, payouts: [], winnerUserId: null } satisfies Settlement
    }

    const { rows: seats } = await client.query<SeatRow>('SELECT seat, user_id, entry_tx_id FROM game_players WHERE room_id = $1 ORDER BY seat', [input.roomId])
    const winner = input.winnerSeat === null ? null : seats.find((s) => s.seat === input.winnerSeat)
    if (input.outcome !== 'DRAW' && !winner) throw new Error('settlement: winner seat is not part of this room')

    const paidSeats = seats.filter((s) => s.entry_tx_id)
    const prizePool = room.entry_fee * paidSeats.length

    const { rows: inserted } = await client.query<{ id: string }>(
      `INSERT INTO game_results (room_id, game_key, winner_user_id, winner_seat, outcome, prize_pool, final_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (room_id) DO NOTHING RETURNING id`,
      [input.roomId, room.game_key, winner?.user_id ?? null, input.winnerSeat, input.outcome, prizePool, JSON.stringify(input.finalState)],
    )
    if (!inserted[0]) return { alreadySettled: true, prizePool: 0, payouts: [], winnerUserId: null } satisfies Settlement

    // 1. Capture every held entry fee into the prize pool.
    for (const seat of paidSeats) {
      await ledger.post(client, {
        userId: seat.user_id!,
        type: 'ENTRY_FEE',
        kind: 'CAPTURE',
        amount: room.entry_fee,
        gameId: input.roomId,
        referenceId: seat.entry_tx_id,
        idempotencyKey: `capture:${seat.entry_tx_id}`,
        metadata: { roomCode: room.code, game: room.game_key },
      })
      await ledger.setStatus(client, seat.entry_tx_id!, 'COMPLETED')
    }

    // 2. Pay out. Bots (practice) never hold credits, so a bot win pays nothing.
    const payouts: Settlement['payouts'] = []
    if (prizePool > 0) {
      if (input.outcome === 'DRAW') {
        const humans = paidSeats
        const share = Math.floor(prizePool / humans.length)
        let remainder = prizePool - share * humans.length
        for (const s of humans) {
          const amount = share + (remainder-- > 0 ? 1 : 0)
          if (amount > 0) payouts.push({ userId: s.user_id!, seat: s.seat, amount })
        }
      } else if (winner?.user_id) {
        payouts.push({ userId: winner.user_id, seat: winner.seat, amount: prizePool })
      }
    }
    for (const p of payouts) {
      await ledger.post(client, {
        userId: p.userId,
        type: 'PRIZE',
        kind: 'CREDIT',
        amount: p.amount,
        gameId: input.roomId,
        idempotencyKey: `prize:${input.roomId}:${p.userId}`,
        metadata: { roomCode: room.code, game: room.game_key, outcome: input.outcome },
      })
    }

    // 3. Stats & XP (practice games only grant a little XP).
    await updateStats(client, room, seats, winner?.user_id ?? null, payouts)

    await client.query(`UPDATE game_rooms SET status = 'COMPLETED', ended_at = now() WHERE id = $1`, [input.roomId])
    await audit(
      { action: 'game.settled', targetType: 'room', targetId: input.roomId, details: { outcome: input.outcome, winnerSeat: input.winnerSeat, prizePool, payouts } },
      client,
    )
    return { alreadySettled: false, resultId: inserted[0].id, prizePool, payouts, winnerUserId: winner?.user_id ?? null } satisfies Settlement
  })
  if (!result.alreadySettled) await invalidate('leaderboard:global', 'leaderboard:weekly')
  return result
}

async function updateStats(client: pg.PoolClient, room: { game_key: string; is_practice: boolean }, seats: SeatRow[], winnerUserId: string | null, payouts: Settlement['payouts']) {
  for (const s of seats) {
    if (!s.user_id) continue
    const won = s.user_id === winnerUserId
    const xp = room.is_practice ? XP.practice : XP.play + (won ? XP.win : 0)
    await client.query('UPDATE user_profiles SET xp = xp + $2 WHERE user_id = $1', [s.user_id, xp])
    if (room.is_practice) continue
    const credits = payouts.filter((p) => p.userId === s.user_id).reduce((a, p) => a + p.amount, 0)
    await client.query(
      `INSERT INTO leaderboards (user_id, game_key, games_played, wins, credits_won) VALUES ($1, $2, 1, $3, $4)
       ON CONFLICT (user_id, game_key) DO UPDATE SET
         games_played = leaderboards.games_played + 1,
         wins = leaderboards.wins + EXCLUDED.wins,
         credits_won = leaderboards.credits_won + EXCLUDED.credits_won,
         updated_at = now()`,
      [s.user_id, room.game_key, won ? 1 : 0, credits],
    )
  }
}

/** Cancels a room that never finished and releases every entry-fee hold back to its owner. Idempotent. */
export async function cancelRoom(roomId: string, reason: string, actorId?: string) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM game_rooms WHERE id = $1 FOR UPDATE', [roomId])
    const room = rows[0]
    if (!room || room.status === 'COMPLETED' || room.status === 'CANCELLED') return { refunded: [] as string[], changed: false }
    const { rows: seats } = await client.query<SeatRow>('SELECT seat, user_id, entry_tx_id FROM game_players WHERE room_id = $1', [roomId])
    const refunded: string[] = []
    for (const s of seats) {
      if (!s.entry_tx_id || !s.user_id) continue
      await refundHold(client, s.user_id, s.entry_tx_id, room.entry_fee, roomId, reason)
      refunded.push(s.user_id)
    }
    await client.query(`UPDATE game_rooms SET status = 'CANCELLED', ended_at = now() WHERE id = $1`, [roomId])
    await audit({ actorId: actorId ?? null, action: 'room.cancelled', targetType: 'room', targetId: roomId, details: { reason, refunded } }, client)
    return { refunded, changed: true }
  })
}

export async function refundHold(client: pg.PoolClient, userId: string, holdTxId: string, amount: number, roomId: string, reason: string) {
  await ledger.post(client, {
    userId,
    type: 'REFUND',
    kind: 'RELEASE',
    amount,
    gameId: roomId,
    referenceId: holdTxId,
    idempotencyKey: `refund:${holdTxId}`,
    metadata: { reason },
  })
  await ledger.setStatus(client, holdTxId, 'REVERSED')
}
