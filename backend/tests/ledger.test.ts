import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pool, withTransaction } from '../src/database/pool.js'
import * as ledger from '../src/modules/ledger/ledger.service.js'
import { ensureSignupBonus } from '../src/modules/wallet/wallet.service.js'
import { redis } from '../src/redis/client.js'
import { balance, makeUser, prepareDb } from './helpers.js'

beforeAll(prepareDb)
afterAll(async () => {
  await pool.end()
  redis.disconnect()
})

describe('wallet ledger', () => {
  it('grants exactly 1000 welcome credits, once, even when called repeatedly and concurrently', async () => {
    const user = await makeUser()
    await Promise.all(Array.from({ length: 8 }, () => ensureSignupBonus(user.id)))
    expect(await balance(user.id)).toEqual({ available: 1000, locked: 0 })
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ledger_transactions WHERE user_id = $1 AND transaction_type = 'SIGNUP_BONUS'`, [user.id])
    expect(rows[0].n).toBe(1)
  })

  it('two simultaneous requests cannot double-spend a wallet', async () => {
    const user = await makeUser()
    // 10 concurrent holds of 300 against a 1000 balance: exactly 3 may succeed.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        withTransaction((c) => ledger.post(c, { userId: user.id, type: 'ENTRY_FEE', kind: 'HOLD', amount: 300, idempotencyKey: `t:${randomUUID()}` })),
      ),
    )
    const ok = results.filter((r) => r.status === 'fulfilled').length
    const insufficient = results.filter((r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'INSUFFICIENT_CREDITS').length
    expect(ok).toBe(3)
    expect(insufficient).toBe(7)
    expect(await balance(user.id)).toEqual({ available: 100, locked: 900 })
  })

  it('replaying an idempotency key returns the original transaction instead of posting again', async () => {
    const user = await makeUser()
    const key = `t:${randomUUID()}`
    const runs = await Promise.allSettled(
      Array.from({ length: 5 }, () => withTransaction((c) => ledger.post(c, { userId: user.id, type: 'ENTRY_FEE', kind: 'HOLD', amount: 100, idempotencyKey: key }))),
    )
    const fulfilled = runs.filter((r): r is PromiseFulfilledResult<{ tx: ledger.LedgerTx; replayed: boolean }> => r.status === 'fulfilled')
    expect(new Set(fulfilled.map((r) => r.value.tx.transaction_id)).size).toBe(1)
    expect(fulfilled.filter((r) => !r.value.replayed)).toHaveLength(1)
    expect(await balance(user.id)).toEqual({ available: 900, locked: 100 })
  })

  it('rejects reuse of an idempotency key for a different operation', async () => {
    const user = await makeUser()
    const key = `t:${randomUUID()}`
    await withTransaction((c) => ledger.post(c, { userId: user.id, type: 'ENTRY_FEE', kind: 'HOLD', amount: 50, idempotencyKey: key }))
    await expect(withTransaction((c) => ledger.post(c, { userId: user.id, type: 'ENTRY_FEE', kind: 'HOLD', amount: 60, idempotencyKey: key }))).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
  })

  it('the ledger is append-only at the database level', async () => {
    const user = await makeUser()
    const { rows } = await pool.query('SELECT transaction_id FROM ledger_transactions WHERE user_id = $1', [user.id])
    await expect(pool.query('UPDATE ledger_transactions SET amount = 999999 WHERE transaction_id = $1', [rows[0].transaction_id])).rejects.toThrow(/immutable/)
    await expect(pool.query('DELETE FROM ledger_transactions WHERE transaction_id = $1', [rows[0].transaction_id])).rejects.toThrow(/append-only/)
  })

  it('wallet projections always reconcile with the ledger', async () => {
    const result = await ledger.reconcile()
    expect(result.walletsChecked).toBeGreaterThan(0)
    expect(result.mismatches).toEqual([])
  })
})
