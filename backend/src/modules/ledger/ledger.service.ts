import type pg from 'pg'
import { pool, withTransaction } from '../../database/pool.js'
import { AppError, Errors } from '../../lib/errors.js'

export type TransactionType = 'SIGNUP_BONUS' | 'ENTRY_FEE' | 'PRIZE' | 'REFUND'
/** HOLD: available→locked (fee reserved) · CAPTURE: locked→prize pool · RELEASE: locked→available (refund) · CREDIT: →available (grant/prize) */
export type EntryKind = 'CREDIT' | 'HOLD' | 'CAPTURE' | 'RELEASE'
export type TxStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED'

export interface PostInput {
  userId: string
  type: TransactionType
  kind: EntryKind
  amount: number
  idempotencyKey: string
  gameId?: string | null
  referenceId?: string | null
  status?: TxStatus
  metadata?: Record<string, unknown>
}

export interface LedgerTx {
  transaction_id: string
  user_id: string
  game_id: string | null
  amount: number
  transaction_type: TransactionType
  entry_kind: EntryKind
  available_delta: number
  locked_delta: number
  status: TxStatus
  reference_id: string | null
  idempotency_key: string
  metadata: Record<string, unknown>
  created_at: string
}

const DELTAS: Record<EntryKind, (amount: number) => [available: number, locked: number]> = {
  CREDIT: (a) => [a, 0],
  HOLD: (a) => [-a, a],
  CAPTURE: (a) => [0, -a],
  RELEASE: (a) => [a, -a],
}

/**
 * Appends one ledger line and updates the wallet projection atomically.
 * MUST be called with a client inside an open transaction.
 *
 * Concurrency: the wallet row is locked with SELECT … FOR UPDATE, so concurrent postings for the
 * same user serialize; the balance check therefore sees every earlier committed posting and two
 * parallel spends can never both succeed. The UNIQUE idempotency_key is the final backstop.
 *
 * Idempotency: re-posting an existing key returns the original transaction (`replayed: true`)
 * provided it describes the same operation; a mismatched reuse is rejected.
 */
export async function post(client: pg.PoolClient, input: PostInput): Promise<{ tx: LedgerTx; replayed: boolean }> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw Errors.badRequest('Amount must be a positive whole number of credits.')

  await client.query('INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [input.userId])
  const { rows: walletRows } = await client.query<{ available: number; locked: number }>(
    'SELECT available, locked FROM wallets WHERE user_id = $1 FOR UPDATE',
    [input.userId],
  )
  const wallet = walletRows[0]

  const existing = await client.query<LedgerTx>('SELECT * FROM ledger_transactions WHERE idempotency_key = $1', [input.idempotencyKey])
  if (existing.rows[0]) {
    const tx = existing.rows[0]
    if (tx.user_id !== input.userId || tx.amount !== input.amount || tx.transaction_type !== input.type || tx.entry_kind !== input.kind) {
      throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different operation.')
    }
    return { tx, replayed: true }
  }

  const [availableDelta, lockedDelta] = DELTAS[input.kind](input.amount)
  if (wallet.available + availableDelta < 0) throw Errors.insufficientCredits()
  if (wallet.locked + lockedDelta < 0) throw new AppError(409, 'LEDGER_INVARIANT', 'Locked balance would become negative.')

  const { rows } = await client.query<LedgerTx>(
    `INSERT INTO ledger_transactions
       (user_id, game_id, amount, transaction_type, entry_kind, available_delta, locked_delta, status, reference_id, idempotency_key, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      input.userId,
      input.gameId ?? null,
      input.amount,
      input.type,
      input.kind,
      availableDelta,
      lockedDelta,
      input.status ?? 'COMPLETED',
      input.referenceId ?? null,
      input.idempotencyKey,
      input.metadata ?? {},
    ],
  )
  await client.query(
    `UPDATE wallets SET available = available + $2, locked = locked + $3, version = version + 1, updated_at = now() WHERE user_id = $1`,
    [input.userId, availableDelta, lockedDelta],
  )
  return { tx: rows[0], replayed: false }
}

/** Convenience wrapper that opens its own transaction. */
export const postStandalone = (input: PostInput) => withTransaction((c) => post(c, input))

export async function setStatus(client: pg.PoolClient, transactionId: string, status: TxStatus) {
  await client.query('UPDATE ledger_transactions SET status = $2 WHERE transaction_id = $1', [transactionId, status])
}

export async function getBalance(userId: string) {
  const { rows } = await pool.query<{ available: number; locked: number; version: number }>(
    'SELECT available, locked, version FROM wallets WHERE user_id = $1',
    [userId],
  )
  return rows[0] ?? { available: 0, locked: 0, version: 0 }
}

/** Entry fees held today — used to enforce the responsible-gaming daily virtual spending limit. */
export async function spentToday(client: pg.PoolClient | pg.Pool, userId: string) {
  const { rows } = await client.query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM ledger_transactions
     WHERE user_id = $1 AND transaction_type = 'ENTRY_FEE' AND entry_kind = 'HOLD' AND created_at >= date_trunc('day', now())`,
    [userId],
  )
  return rows[0].total
}

/** Verifies the wallet projection equals the sum of ledger lines for every wallet. Returns mismatches. */
export async function reconcile() {
  const { rows } = await pool.query<{ user_id: string; available: number; locked: number; ledger_available: number; ledger_locked: number }>(
    `SELECT w.user_id, w.available, w.locked,
            COALESCE(SUM(l.available_delta), 0)::bigint AS ledger_available,
            COALESCE(SUM(l.locked_delta), 0)::bigint AS ledger_locked
       FROM wallets w LEFT JOIN ledger_transactions l ON l.user_id = w.user_id
      GROUP BY w.user_id, w.available, w.locked`,
  )
  const mismatches = rows.filter((r) => r.available !== r.ledger_available || r.locked !== r.ledger_locked)
  return { walletsChecked: rows.length, mismatches }
}
