import type pg from 'pg'
import { env } from '../../config/env.js'
import { pool, withTransaction } from '../../database/pool.js'
import * as ledger from '../ledger/ledger.service.js'

/**
 * Virtual-credit wallet. There is NO deposit, withdrawal or payment path.
 * Credits enter the system exactly once per account (the signup grant) and afterwards only move
 * between entry-fee holds, prize pools, prizes and refunds — all as ledger lines.
 */
export const signupBonusKey = (userId: string) => `signup-bonus:${userId}`

/**
 * Grants the one-time welcome credits. Safe to call on every login: the idempotency key
 * `signup-bonus:<userId>` makes repeat calls return the original grant instead of paying again.
 */
export async function ensureSignupBonus(userId: string, client?: pg.PoolClient) {
  const grant = (c: pg.PoolClient) =>
    ledger.post(c, {
      userId,
      type: 'SIGNUP_BONUS',
      kind: 'CREDIT',
      amount: env.SIGNUP_BONUS_CREDITS,
      idempotencyKey: signupBonusKey(userId),
      metadata: { reason: 'Welcome grant — virtual credits, no real value' },
    })
  return client ? grant(client) : withTransaction(grant)
}

export async function getSummary(userId: string) {
  const balance = await ledger.getBalance(userId)
  const { rows } = await pool.query<{ winnings: number; total_games: number; total_wins: number }>(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0)::bigint FROM ledger_transactions WHERE user_id = $1 AND transaction_type = 'PRIZE') AS winnings,
       (SELECT count(*)::int FROM game_players gp JOIN game_rooms r ON r.id = gp.room_id
         WHERE gp.user_id = $1 AND r.status = 'COMPLETED' AND NOT r.is_practice) AS total_games,
       (SELECT count(*)::int FROM game_results gr JOIN game_rooms r ON r.id = gr.room_id
         WHERE gr.winner_user_id = $1 AND NOT r.is_practice) AS total_wins`,
    [userId],
  )
  return {
    ...balance,
    ...rows[0],
    signupBonus: env.SIGNUP_BONUS_CREDITS,
    currency: 'VIRTUAL_CREDITS',
    notice: 'VIRTUAL CREDITS — NO REAL VALUE. Cannot be bought, sold or withdrawn.',
  }
}

export async function listTransactions(userId: string, { limit, cursor, type }: { limit: number; cursor?: string; type?: string }) {
  const params: unknown[] = [userId, limit + 1]
  let where = 'user_id = $1'
  if (type) {
    params.push(type)
    where += ` AND transaction_type = $${params.length}`
  }
  if (cursor) {
    params.push(cursor)
    where += ` AND created_at < $${params.length}`
  }
  const { rows } = await pool.query(
    `SELECT transaction_id, game_id, amount, transaction_type, entry_kind, available_delta, locked_delta,
            status, reference_id, idempotency_key, metadata, created_at
       FROM ledger_transactions WHERE ${where} ORDER BY created_at DESC LIMIT $2`,
    params,
  )
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit)
  return { items, nextCursor: hasMore ? items[items.length - 1].created_at : null }
}
