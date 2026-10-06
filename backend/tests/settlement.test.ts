import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pool } from '../src/database/pool.js'
import * as rooms from '../src/modules/rooms/rooms.service.js'
import { cancelRoom, settleGame } from '../src/modules/rooms/settlement.service.js'
import { reconcile } from '../src/modules/ledger/ledger.service.js'
import { redis } from '../src/redis/client.js'
import { balance, makeUser, prepareDb } from './helpers.js'

beforeAll(prepareDb)
afterAll(async () => {
  await pool.end()
  redis.disconnect()
})

async function twoPlayerRoom(fee: number) {
  const a = await makeUser('a')
  const b = await makeUser('b')
  const room = await rooms.createRoom(a.id, { gameKey: 'tictactoe', entryFee: fee, maxPlayers: 2, isPrivate: false })
  await rooms.joinRoom(b.id, room.id)
  await rooms.setStatus(room.id, 'IN_PROGRESS')
  return { a, b, room }
}

describe('game settlement', () => {
  it('holds entry fees on join', async () => {
    const { a, b } = await twoPlayerRoom(100)
    expect(await balance(a.id)).toEqual({ available: 900, locked: 100 })
    expect(await balance(b.id)).toEqual({ available: 900, locked: 100 })
  })

  it('a game cannot settle twice — even when settlement runs concurrently', async () => {
    const { a, b, room } = await twoPlayerRoom(100)
    const results = await Promise.all(Array.from({ length: 5 }, () => settleGame({ roomId: room.id, outcome: 'WIN', winnerSeat: 0, finalState: {} })))
    expect(results.filter((r) => !r.alreadySettled)).toHaveLength(1)
    expect(await balance(a.id)).toEqual({ available: 1100, locked: 0 })
    expect(await balance(b.id)).toEqual({ available: 900, locked: 0 })
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ledger_transactions WHERE game_id = $1 AND transaction_type = 'PRIZE'`, [room.id])
    expect(rows[0].n).toBe(1)
    // Settling again later is still a no-op.
    expect((await settleGame({ roomId: room.id, outcome: 'WIN', winnerSeat: 1, finalState: {} })).alreadySettled).toBe(true)
    expect(await balance(b.id)).toEqual({ available: 900, locked: 0 })
  })

  it('splits the pool on a draw', async () => {
    const { a, b, room } = await twoPlayerRoom(50)
    await settleGame({ roomId: room.id, outcome: 'DRAW', winnerSeat: null, finalState: {} })
    expect(await balance(a.id)).toEqual({ available: 1000, locked: 0 })
    expect(await balance(b.id)).toEqual({ available: 1000, locked: 0 })
  })

  it('leaving before start refunds the entry fee; cancelling refunds everyone exactly once', async () => {
    const a = await makeUser('a')
    const b = await makeUser('b')
    const room = await rooms.createRoom(a.id, { gameKey: 'ludo', entryFee: 200, maxPlayers: 4, isPrivate: false })
    await rooms.joinRoom(b.id, room.id)
    await rooms.leaveWaitingRoom(b.id, room.id)
    expect(await balance(b.id)).toEqual({ available: 1000, locked: 0 })
    await Promise.all([cancelRoom(room.id, 'test'), cancelRoom(room.id, 'test')])
    expect(await balance(a.id)).toEqual({ available: 1000, locked: 0 })
  })

  it('rejects joining with insufficient credits and leaves no partial state', async () => {
    const a = await makeUser('a')
    const b = await makeUser('b')
    const room = await rooms.createRoom(a.id, { gameKey: 'carrom', entryFee: 5000, maxPlayers: 2, isPrivate: false }).catch((e) => e)
    expect(room).toMatchObject({ code: 'INSUFFICIENT_CREDITS' })
    expect(await balance(a.id)).toEqual({ available: 1000, locked: 0 })
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM game_rooms WHERE host_id = $1', [a.id])
    expect(rows[0].n).toBe(0)
    void b
  })

  it('enforces the daily virtual spending limit', async () => {
    const a = await makeUser('a')
    await pool.query('UPDATE user_settings SET daily_spend_limit = 150 WHERE user_id = $1', [a.id])
    await rooms.createRoom(a.id, { gameKey: 'tictactoe', entryFee: 100, maxPlayers: 2, isPrivate: false })
    const b = await makeUser('b')
    const other = await rooms.createRoom(b.id, { gameKey: 'connectfour', entryFee: 100, maxPlayers: 2, isPrivate: false })
    await rooms.leaveWaitingRoom(a.id, (await pool.query('SELECT room_id FROM game_players WHERE user_id = $1', [a.id])).rows[0].room_id)
    await expect(rooms.joinRoom(a.id, other.id)).rejects.toMatchObject({ code: 'DAILY_LIMIT_REACHED' })
  })

  it('ledger still reconciles after all of the above', async () => {
    expect((await reconcile()).mismatches).toEqual([])
  })
})
