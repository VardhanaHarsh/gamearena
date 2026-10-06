import { describe, expect, it } from 'vitest'
import type { PlayerRef } from '../src/modules/games/engine.js'
import { carromEngine, COIN_R, simulate } from '../src/modules/games/engines/carrom.engine.js'
import { connectFourEngine } from '../src/modules/games/engines/connectfour.engine.js'
import { HOME, ludoEngine, YARD, absoluteSquare, type LudoState } from '../src/modules/games/engines/ludo.engine.js'
import { ticTacToeEngine } from '../src/modules/games/engines/tictactoe.engine.js'
import { seededRng } from '../src/modules/games/rng.js'

const players = (n: number): PlayerRef[] => Array.from({ length: n }, (_, i) => ({ seat: i, userId: `u${i}`, name: `P${i}`, isBot: false }))
const fixedDice = (...values: number[]) => {
  let i = 0
  return { int: () => values[i++ % values.length], float: () => 0.5 }
}

describe('Tic-Tac-Toe engine', () => {
  it('detects a win and rejects moves afterwards', () => {
    let s = ticTacToeEngine.createGame(players(2), seededRng(1))
    for (const [seat, cell] of [[0, 0], [1, 3], [0, 1], [1, 4], [0, 2]] as const) {
      const v = ticTacToeEngine.validateMove(s, seat, { type: 'place', cell })
      expect(v.ok).toBe(true)
      if (v.ok) s = ticTacToeEngine.applyMove(s, seat, v.move, seededRng(1))
    }
    expect(ticTacToeEngine.getWinner(s)).toEqual({ finished: true, outcome: 'WIN', winnerSeat: 0 })
    expect(ticTacToeEngine.validateMove(s, 1, { type: 'place', cell: 8 }).ok).toBe(false)
  })

  it('an invalid move cannot modify server state', () => {
    const s = ticTacToeEngine.createGame(players(2), seededRng(1))
    const before = JSON.stringify(s)
    expect(ticTacToeEngine.validateMove(s, 1, { type: 'place', cell: 0 }).ok).toBe(false) // not your turn
    expect(ticTacToeEngine.validateMove(s, 0, { type: 'place', cell: 9 }).ok).toBe(false) // off board
    expect(ticTacToeEngine.validateMove(s, 0, { type: 'hack', winner: 0 }).ok).toBe(false)
    expect(JSON.stringify(s)).toBe(before)
  })

  it('applyMove is pure (does not mutate its input)', () => {
    const s = ticTacToeEngine.createGame(players(2), seededRng(1))
    const before = JSON.stringify(s)
    ticTacToeEngine.applyMove(s, 0, { type: 'place', cell: 4 }, seededRng(1))
    expect(JSON.stringify(s)).toBe(before)
  })

  it('forfeit leaves the remaining player as winner', () => {
    const s = ticTacToeEngine.endGame(ticTacToeEngine.createGame(players(2), seededRng(1)), 0)
    expect(ticTacToeEngine.getWinner(s)).toEqual({ finished: true, outcome: 'FORFEIT', winnerSeat: 1 })
  })
})

describe('Connect Four engine', () => {
  it('detects a vertical connect-four', () => {
    let s = connectFourEngine.createGame(players(2), seededRng(1))
    for (const [seat, col] of [[0, 3], [1, 4], [0, 3], [1, 4], [0, 3], [1, 4], [0, 3]] as const) {
      const v = connectFourEngine.validateMove(s, seat, { type: 'drop', col })
      expect(v.ok).toBe(true)
      if (v.ok) s = connectFourEngine.applyMove(s, seat, v.move, seededRng(1))
    }
    expect(connectFourEngine.getWinner(s)).toMatchObject({ finished: true, winnerSeat: 0 })
  })

  it('rejects a full column', () => {
    let s = connectFourEngine.createGame(players(2), seededRng(1))
    for (let i = 0; i < 6; i++) s = connectFourEngine.applyMove(s, i % 2, { type: 'drop', col: 0 }, seededRng(1))
    expect(connectFourEngine.validateMove(s, s.turnSeat, { type: 'drop', col: 0 })).toMatchObject({ ok: false })
  })
})

describe('Ludo engine', () => {
  it('rejects client-supplied dice values and flags them as suspicious', () => {
    const s = ludoEngine.createGame(players(2), seededRng(1))
    const v = ludoEngine.validateMove(s, 0, { type: 'roll', dice: 6 })
    expect(v).toMatchObject({ ok: false, suspicious: true })
  })

  it('needs a 6 to leave the yard; otherwise the turn passes', () => {
    const s = ludoEngine.createGame(players(2), seededRng(1))
    const after = ludoEngine.applyMove(s, 0, { type: 'roll' }, fixedDice(3))
    expect(after.turnSeat).toBe(1)
    expect(after.tokens[0]).toEqual([YARD, YARD, YARD, YARD])
  })

  it('rolling a 6 lets a token out and grants a bonus roll', () => {
    let s = ludoEngine.createGame(players(2), seededRng(1))
    s = ludoEngine.applyMove(s, 0, { type: 'roll' }, fixedDice(6))
    expect(s.phase).toBe('MOVE')
    expect(s.legalTokens).toEqual([0, 1, 2, 3])
    s = ludoEngine.applyMove(s, 0, { type: 'move', token: 2 }, fixedDice(6))
    expect(s.tokens[0][2]).toBe(0)
    expect(s.turnSeat).toBe(0)
    expect(s.phase).toBe('ROLL')
  })

  it('captures an opponent on a non-safe square', () => {
    const s = ludoEngine.createGame(players(2), seededRng(1)) as LudoState
    // red (seat 0) token at progress 2 → abs 2; yellow (seat 1) token sitting on abs 5
    s.tokens[0][0] = 2
    s.tokens[1][0] = (5 - 26 + 52) % 52
    expect(absoluteSquare('yellow', s.tokens[1][0])).toBe(5)
    let next = ludoEngine.applyMove(s, 0, { type: 'roll' }, fixedDice(3))
    next = ludoEngine.applyMove(next, 0, { type: 'move', token: 0 }, fixedDice(3))
    expect(next.tokens[1][0]).toBe(YARD)
    expect(next.turnSeat).toBe(0) // capture earns a bonus roll
  })

  it('requires an exact roll to reach home and declares the winner', () => {
    const s = ludoEngine.createGame(players(2), seededRng(1))
    s.tokens[0] = [HOME, HOME, HOME, HOME - 2]
    let next = ludoEngine.applyMove(s, 0, { type: 'roll' }, fixedDice(5))
    expect(next.turnSeat).toBe(1) // 5 overshoots — no legal move
    next.turnSeat = 0
    next = ludoEngine.applyMove(next, 0, { type: 'roll' }, fixedDice(2))
    next = ludoEngine.applyMove(next, 0, { type: 'move', token: 3 }, fixedDice(2))
    expect(ludoEngine.getWinner(next)).toEqual({ finished: true, outcome: 'WIN', winnerSeat: 0 })
  })

  it('three sixes in a row forfeits the turn', () => {
    let s = ludoEngine.createGame(players(2), seededRng(1))
    s.tokens[0][0] = 10
    for (let i = 0; i < 2; i++) {
      s = ludoEngine.applyMove(s, 0, { type: 'roll' }, fixedDice(6))
      s = ludoEngine.applyMove(s, 0, { type: 'move', token: 0 }, fixedDice(6))
    }
    s = ludoEngine.applyMove(s, 0, { type: 'roll' }, fixedDice(6))
    expect(s.turnSeat).toBe(1)
  })

  it('bots can always finish a game', () => {
    const rng = seededRng(42)
    let s = ludoEngine.createGame(players(4), rng)
    for (let i = 0; i < 5000 && !ludoEngine.getWinner(s).finished; i++) {
      const seat = ludoEngine.getCurrentSeat(s)!
      const move = ludoEngine.autoMove(s, seat, rng)!
      const v = ludoEngine.validateMove(s, seat, move)
      expect(v.ok).toBe(true)
      if (v.ok) s = ludoEngine.applyMove(s, seat, v.move, rng)
    }
    expect(ludoEngine.getWinner(s).finished).toBe(true)
  })
})

describe('Carrom engine', () => {
  it('simulation is deterministic and comes to rest', () => {
    const s = carromEngine.createGame(players(2), seededRng(1))
    const a = simulate({ x: 50, y: 82, vx: 0, vy: -150 }, s.coins)
    const b = simulate({ x: 50, y: 82, vx: 0, vy: -150 }, s.coins)
    expect(a.frames).toEqual(b.frames)
    expect(a.bodies.every((body) => body.pocketed || Math.hypot(body.vx, body.vy) === 0)).toBe(true)
  })

  it('rejects backward shots and out-of-range power', () => {
    const s = carromEngine.createGame(players(2), seededRng(1))
    expect(carromEngine.validateMove(s, 0, { type: 'shot', position: 0.5, angle: Math.PI / 2, power: 0.5 })).toMatchObject({ ok: false, suspicious: true })
    expect(carromEngine.validateMove(s, 0, { type: 'shot', position: 0.5, angle: -Math.PI / 2, power: 5 }).ok).toBe(false)
    expect(carromEngine.validateMove(s, 0, { type: 'shot', position: 0.5, angle: -Math.PI / 2, power: 0.8 }).ok).toBe(true)
  })

  it('coins never overlap after a shot', () => {
    const s = carromEngine.createGame(players(2), seededRng(1))
    const next = carromEngine.applyMove(s, 0, { type: 'shot', position: 0.5, angle: -Math.PI / 2, power: 1 }, seededRng(1))
    const live = next.coins.filter((c) => !c.pocketed)
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) expect(Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y)).toBeGreaterThan(COIN_R * 2 - 0.3)
    expect(next.lastShot?.frames.length).toBeGreaterThan(2)
  })

  it('bots can always finish a game', () => {
    const rng = seededRng(7)
    let s = carromEngine.createGame(players(2), rng)
    for (let i = 0; i < 200 && !carromEngine.getWinner(s).finished; i++) {
      const seat = carromEngine.getCurrentSeat(s)!
      const move = carromEngine.autoMove(s, seat, rng)!
      const v = carromEngine.validateMove(s, seat, move)
      if (v.ok) s = carromEngine.applyMove(s, seat, v.move, rng)
    }
    expect(carromEngine.getWinner(s).finished).toBe(true)
  })
})
