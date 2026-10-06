import type { Db } from '../../database/pool.js'
import { pool } from '../../database/pool.js'
import { AppError } from '../../lib/errors.js'

/** Blocks money-moving / game-joining actions for suspended or self-paused accounts. */
export async function assertCanPlay(userId: string, db: Db = pool) {
  const { rows } = await db.query<{ status: string; paused_until: string | null }>(
    `SELECT u.status, s.paused_until FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = $1`,
    [userId],
  )
  const row = rows[0]
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Account not found.')
  if (row.status === 'SUSPENDED') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended.')
  if (row.paused_until && new Date(row.paused_until) > new Date()) {
    throw new AppError(403, 'ACCOUNT_PAUSED', `Your account is paused until ${new Date(row.paused_until).toLocaleString()}.`)
  }
}
