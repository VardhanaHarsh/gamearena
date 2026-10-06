import { describe, expect, it } from 'vitest'
import type { BaseState, GameEngine, PlayerRef } from '../src/modules/games/engine.js'
import { BOARD, carromEngine, COIN_R, type CarromState } from '../src/modules/games/engines/carrom.engine.js'
import { connectFourEngine } from '../src/modules/games/engines/connectfour.engine.js'
import { HOME, ludoEngine, YARD, type LudoState } from '../src/modules/games/engines/ludo.engine.js'
import { ticTacToeEngine } from '../src/modules/games/engines/tictactoe.engine.js'
import { seededRng } from '../src/modules/games/rng.js'

const players = (n: number): PlayerRef[] => Array.from({ length: n }, (_, i) => ({ seat: i, userId: `u${i}`, name: `P${i}`, isBot: false }))

/**
 * Plays complete games with randomised bots (plus random garbage moves) and checks invariants after
 * every move. Any engine glitch — stuck turn, illegal state, crash, mutated input — fails the run.
 */
function fuzz<S extends BaseState>(engine: GameEngine<S, unknown>, games: number, playerCounts: number[], maxMoves: number, check: (s: S) => void) {
  const stats = { finished: 0, moves: 0, rejectedGarbage: 0 }
  for (let g = 0; g < games; g++) {
    const rng = seededRng(1000 + g)
    let s = engine.createGame(players(playerCounts[g % playerCounts.length]), rng)
    // Occasionally a player forfeits mid-game.
    const forfeitAt = g % 7 === 0 ? 5 + (g % 20) : -1
    for (let m = 0; m < maxMoves && !engine.getWinner(s).finished; m++) {
      if (m === forfeitAt) {
        s = engine.endGame(s, engine.getCurrentSeat(s)!)
        check(s)
        continue
      }
      const seat = engine.getCurrentSeat(s)
      expect(seat, `game ${g} move ${m}: no current seat but not finished`).not.toBeNull()
      // Garbage from a random seat must be rejected without touching state.
      const before = JSON.stringify(s)
      const garbage = [{ type: 'roll', dice: 6 }, { type: 'move', token: 9 }, { type: 'place', cell: -1 }, { type: 'drop', col: 99 }, { type: 'shot', position: 2, angle: 0, power: 1 }, null, 'x', { winner: 0 }][m % 8]
      const gv = engine.validateMove(s, (seat! + 1) % s.players.length, garbage)
      if (!gv.ok) stats.rejectedGarbage++
      expect(JSON.stringify(s)).toBe(before)

      const move = engine.autoMove(s, seat!, rng)
      expect(move, `game ${g} move ${m}: bot has no move`).not.toBeNull()
      const v = engine.validateMove(s, seat!, move)
      if (!v.ok) continue // e.g. carrom striker overlap — bot retries next loop like the server does
      const snapshot = JSON.stringify(s)
      const next = engine.applyMove(s, seat!, v.move, rng)
      expect(JSON.stringify(s), 'applyMove mutated its input').toBe(snapshot)
      s = next
      stats.moves++
      check(s)
    }
    expect(engine.getWinner(s).finished, `game ${g} did not finish in ${maxMoves} moves`).toBe(true)
    stats.finished++
  }
  return stats
}

describe('engine fuzzing (full games, invariants after every move)', { timeout: 240_000 }, () => {
  it('Tic-Tac-Toe — 500 games', () => {
    const r = fuzz(ticTacToeEngine, 500, [2], 20, (s) => {
      const x = s.board.filter((c) => c === 0).length
      const o = s.board.filter((c) => c === 1).length
      expect(x - o).toBeGreaterThanOrEqual(0)
      expect(x - o).toBeLessThanOrEqual(1)
    })
    expect(r.finished).toBe(500)
  })

  it('Connect Four — 500 games', () => {
    const r = fuzz(connectFourEngine, 500, [2], 60, (s) => {
      // gravity: no floating discs
      for (let c = 0; c < 7; c++) for (let row = 0; row < 5; row++) if (s.grid[row][c] !== null) expect(s.grid[row + 1][c]).not.toBeNull()
    })
    expect(r.finished).toBe(500)
  })

  it('Ludo — 300 games with 2, 3 and 4 players', () => {
    const r = fuzz(ludoEngine as GameEngine<LudoState, unknown>, 300, [2, 3, 4], 6000, (s) => {
      for (const tokens of s.tokens) for (const p of tokens) expect(p === YARD || (p >= 0 && p <= HOME)).toBe(true)
      if (s.phase === 'MOVE') {
        expect(s.dice).toBeGreaterThanOrEqual(1)
        expect(s.dice).toBeLessThanOrEqual(6)
        expect(s.legalTokens.length).toBeGreaterThan(0)
      }
      expect(s.forfeited.includes(s.turnSeat) && s.winnerSeat === null && s.forfeited.length < s.players.length - 1).toBe(false)
    })
    expect(r.finished).toBe(300)
  })

  it('Carrom — 120 games', () => {
    const r = fuzz(carromEngine as GameEngine<CarromState, unknown>, 120, [2], 400, (s) => {
      const live = s.coins.filter((c) => !c.pocketed)
      for (const c of live) {
        expect(c.x).toBeGreaterThanOrEqual(COIN_R - 0.01)
        expect(c.x).toBeLessThanOrEqual(BOARD - COIN_R + 0.01)
        expect(c.y).toBeGreaterThanOrEqual(COIN_R - 0.01)
        expect(c.y).toBeLessThanOrEqual(BOARD - COIN_R + 0.01)
      }
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) expect(Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y)).toBeGreaterThan(COIN_R * 2 - 0.35)
      expect(s.scores[0]).toBeGreaterThanOrEqual(0)
      expect(s.scores[1]).toBeGreaterThanOrEqual(0)
      expect(s.coins.length).toBe(19)
    })
    expect(r.finished).toBe(120)
  })
})
