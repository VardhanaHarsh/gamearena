import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { io as connect, type Socket } from 'socket.io-client'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { pool } from '../src/database/pool.js'
import { redis } from '../src/redis/client.js'
import { gameServer } from '../src/websocket/gameServer.js'
import { createSocketServer } from '../src/websocket/index.js'
import { balance, prepareDb } from './helpers.js'

let http: HttpServer
let url = ''
const app = createApp()
const sockets: Socket[] = []

beforeAll(async () => {
  await prepareDb()
  http = createServer(app)
  createSocketServer(http)
  await new Promise<void>((r) => http.listen(0, r))
  url = `http://localhost:${(http.address() as AddressInfo).port}`
})
afterAll(async () => {
  sockets.forEach((s) => s.disconnect())
  gameServer.shutdown()
  await new Promise((r) => http.close(r))
  await pool.end()
  redis.disconnect()
})

const ack = <T = unknown>(s: Socket, event: string, payload: unknown) =>
  new Promise<{ ok: boolean; data?: T; error?: { code: string; message: string } }>((resolve) => s.emit(event, payload, resolve))
const next = <T = unknown>(s: Socket, event: string, pred: (p: T) => boolean = () => true, ms = 12_000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms)
    const handler = (p: T) => {
      if (!pred(p)) return
      clearTimeout(timer)
      s.off(event, handler)
      resolve(p)
    }
    s.on(event, handler)
  })

async function player(name: string) {
  const res = await request(app).post('/api/auth/register').send({ email: `${name}@mp.local`, username: name, displayName: name, password: 'Password123!' }).expect(201)
  const socket = connect(url, { auth: { token: res.body.accessToken }, transports: ['websocket'], reconnection: false })
  sockets.push(socket)
  await new Promise((r) => socket.on('connect', r))
  return { id: res.body.user.id as string, token: res.body.accessToken as string, socket }
}

interface TttView { seq: number; currentSeat: number | null; state: { board: (number | null)[] } }

describe('real-time multiplayer (Tic-Tac-Toe over Socket.IO)', () => {
  it('rejects unauthenticated sockets', async () => {
    const s = connect(url, { auth: { token: 'bogus' }, transports: ['websocket'], reconnection: false })
    const err = await new Promise<Error>((r) => s.on('connect_error', r))
    expect(err.message).toBe('UNAUTHORIZED')
    s.disconnect()
  })

  it('plays a full game: server-authoritative moves, invalid moves rejected, reconnect, settlement', async () => {
    const alice = await player('mp_alice')
    let bob = await player('mp_bob')

    const created = await request(app).post('/api/rooms').set('Authorization', `Bearer ${alice.token}`).send({ gameKey: 'tictactoe', entryFee: 40, maxPlayers: 2 }).expect(201)
    const roomId = created.body.room.id as string
    await request(app).post(`/api/rooms/${roomId}/join`).set('Authorization', `Bearer ${bob.token}`).expect(200)
    expect(await balance(alice.id)).toEqual({ available: 960, locked: 40 })

    expect((await ack(alice.socket, 'room:join', { roomId })).ok).toBe(true)
    expect((await ack(bob.socket, 'room:join', { roomId })).ok).toBe(true)
    const started = next(alice.socket, 'game:start')
    await ack(alice.socket, 'room:ready', { roomId, ready: true })
    await ack(bob.socket, 'room:ready', { roomId, ready: true })
    await started // full room + all ready → 5s countdown → game starts

    const move = (s: Socket, cell: number, extra: object = {}) => ack(s, 'game:move', { roomId, move: { type: 'place', cell, ...extra }, clientMoveId: randomUUID(), clientTs: Date.now() })

    // Out-of-turn and malformed moves are rejected and do not change state.
    const sync1 = await ack<{ game: TttView }>(alice.socket, 'game:sync', { roomId })
    expect((await move(bob.socket, 4)).error?.code).toBe('INVALID_MOVE')
    expect((await move(alice.socket, 99)).error?.code).toBe('INVALID_MOVE')
    expect((await move(alice.socket, 0, { winner: 0 })).error?.code).toBe('INVALID_MOVE')
    const sync2 = await ack<{ game: TttView }>(alice.socket, 'game:sync', { roomId })
    expect(sync2.data!.game.seq).toBe(sync1.data!.game.seq)
    expect(sync2.data!.game.state.board.every((c) => c === null)).toBe(true)

    // Duplicate client move ids are ignored (replay protection).
    const dupId = randomUUID()
    expect((await ack(alice.socket, 'game:move', { roomId, move: { type: 'place', cell: 0 }, clientMoveId: dupId })).ok).toBe(true)
    expect((await ack(alice.socket, 'game:move', { roomId, move: { type: 'place', cell: 1 }, clientMoveId: dupId })).ok).toBe(false)

    // Bob disconnects and reconnects: he receives the authoritative state again.
    const disconnectSeen = next(alice.socket, 'player:disconnect')
    bob.socket.disconnect()
    await disconnectSeen
    const fresh = connect(url, { auth: { token: bob.token }, transports: ['websocket'], reconnection: false })
    sockets.push(fresh)
    await new Promise((r) => fresh.on('connect', r))
    const reconnectSeen = next(alice.socket, 'player:reconnect')
    const resumed = next<TttView>(fresh, 'game:state')
    await ack(fresh, 'room:join', { roomId })
    expect((await resumed).state.board[0]).toBe(0)
    await reconnectSeen
    bob = { ...bob, socket: fresh }

    // Play it out: alice wins along the top row.
    const ended = next<{ winnerSeat: number; prizePool: number }>(alice.socket, 'game:end')
    expect((await move(bob.socket, 3)).ok).toBe(true)
    expect((await move(alice.socket, 1)).ok).toBe(true)
    expect((await move(bob.socket, 4)).ok).toBe(true)
    expect((await move(alice.socket, 2)).ok).toBe(true)
    const result = await ended
    expect(result.winnerSeat).toBe(0)
    expect(result.prizePool).toBe(80)
    expect(await balance(alice.id)).toEqual({ available: 1040, locked: 0 })
    expect(await balance(bob.id)).toEqual({ available: 960, locked: 0 })

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM game_moves WHERE room_id = $1', [roomId])
    expect(rows[0].n).toBe(5)
    const flags = await pool.query('SELECT reason FROM anticheat_flags WHERE room_id = $1', [roomId])
    expect(flags.rows.map((r) => r.reason)).toEqual(expect.arrayContaining(['IMPOSSIBLE_MOVE', 'DUPLICATE_MOVE']))
  })

  it('practice mode runs against server bots with no credits involved', async () => {
    const solo = await player('mp_solo')
    const res = await request(app).post('/api/rooms/practice').set('Authorization', `Bearer ${solo.token}`).send({ gameKey: 'connectfour', players: 2 }).expect(201)
    const roomId = res.body.room.id
    const started = next(solo.socket, 'game:start')
    await ack(solo.socket, 'room:join', { roomId })
    await started
    expect(await balance(solo.id)).toEqual({ available: 1000, locked: 0 })
  })

  it.each([
    ['chess', { type: 'move', from: 12, to: 28 }], // e2-e4
    ['checkers', { type: 'move', from: 18, to: 27 }], // c3-d4
  ])('%s: a practice game plays a move, gets a bot reply and ends on resignation', async (gameKey, opening) => {
    const solo = await player(`mp_${gameKey}`)
    const res = await request(app).post('/api/rooms/practice').set('Authorization', `Bearer ${solo.token}`).send({ gameKey, players: 2 }).expect(201)
    const roomId = res.body.room.id
    const started = next(solo.socket, 'game:start')
    await ack(solo.socket, 'room:join', { roomId })
    await started
    const botReplied = next<{ state: { moves: string[] }; currentSeat: number }>(solo.socket, 'game:state', (g) => g.state.moves.length === 2 && g.currentSeat === 0)
    expect(await ack(solo.socket, 'game:move', { roomId, move: opening, clientMoveId: randomUUID(), clientTs: Date.now() })).toMatchObject({ ok: true })
    await botReplied
    const ended = next<{ winnerSeat: number; outcome: string }>(solo.socket, 'game:end')
    expect(await ack(solo.socket, 'game:move', { roomId, move: { type: 'resign' }, clientMoveId: randomUUID(), clientTs: Date.now() })).toMatchObject({ ok: true })
    expect(await ended).toMatchObject({ winnerSeat: 1, outcome: 'WIN' })
  })
})
