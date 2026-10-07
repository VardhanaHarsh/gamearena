import { describe, expect, it } from 'vitest'
import type { PlayerRef } from '../src/modules/games/engine.js'
import { carromEngine, COIN_R, simulate } from '../src/modules/games/engines/carrom.engine.js'
import { chessEngine, legalMoves, play, type ChessState, type Piece, type Position } from '../src/modules/games/engines/chess.engine.js'
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

describe('Chess engine', () => {
  const sq = (name: string) => (name.charCodeAt(1) - 49) * 8 + (name.charCodeAt(0) - 97)
  const playAll = (s: ChessState, moves: string[]) => {
    for (const mv of moves) {
      const [from, to, promotion] = [sq(mv.slice(0, 2)), sq(mv.slice(2, 4)), mv[4]]
      const move = { type: 'move', from, to, ...(promotion && { promotion }) }
      const v = chessEngine.validateMove(s, s.turnSeat, move)
      expect(v, mv).toMatchObject({ ok: true })
      if (v.ok) s = chessEngine.applyMove(s, s.turnSeat, v.move, seededRng(1))
    }
    return s
  }
  const fresh = () => chessEngine.createGame(players(2), seededRng(1))

  it('has 20 legal opening moves for White', () => {
    const view = chessEngine.getState(fresh(), 0) as { legal: Record<number, number[]> }
    expect(Object.values(view.legal).flat()).toHaveLength(20)
    expect(chessEngine.getState(fresh(), 1)).toMatchObject({ legal: {} })
  })

  it("detects fool's mate", () => {
    const s = playAll(fresh(), ['f2f3', 'e7e5', 'g2g4', 'd8h4'])
    expect(s.moves).toEqual(['f3', 'e5', 'g4', 'Qh4#'])
    expect(chessEngine.getWinner(s)).toEqual({ finished: true, outcome: 'WIN', winnerSeat: 1 })
    expect(chessEngine.getCurrentSeat(s)).toBeNull()
  })

  it('rejects illegal moves, wrong turns and moving into check', () => {
    const s = fresh()
    const before = JSON.stringify(s)
    expect(chessEngine.validateMove(s, 0, { type: 'move', from: sq('e2'), to: sq('e5') }).ok).toBe(false)
    expect(chessEngine.validateMove(s, 1, { type: 'move', from: sq('e7'), to: sq('e5') }).ok).toBe(false)
    expect(chessEngine.validateMove(s, 0, { type: 'move', from: sq('e7'), to: sq('e5') }).ok).toBe(false)
    expect(chessEngine.validateMove(s, 0, { type: 'move', from: 64, to: 0 })).toMatchObject({ ok: false, suspicious: true })
    expect(JSON.stringify(s)).toBe(before)
    // Pinned knight cannot move.
    const pinned = playAll(fresh(), ['e2e4', 'e7e5', 'd2d4', 'f8b4', 'b1c3', 'a7a6'])
    expect(chessEngine.validateMove(pinned, 0, { type: 'move', from: sq('c3'), to: sq('d5') }).ok).toBe(false)
  })

  it('castles both ways and loses rights after the king moves', () => {
    let s = playAll(fresh(), ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1g1'])
    expect(s.board[sq('g1')]).toBe('K')
    expect(s.board[sq('f1')]).toBe('R')
    expect(s.moves.at(-1)).toBe('O-O')
    expect(s.castling).toBe('kq')
    s = playAll(s, ['d7d6', 'd2d3', 'c8e6', 'c1e3', 'd8d7', 'b1c3', 'e8c8'])
    expect(s.board[sq('c8')]).toBe('k')
    expect(s.board[sq('d8')]).toBe('r')
    expect(s.castling).toBe('')
  })

  it('cannot castle out of, through or into check', () => {
    const setup = (attacker: string) => {
      const s = fresh()
      s.board = Array(64).fill(null)
      s.board[sq('e1')] = 'K'
      s.board[sq('h1')] = 'R'
      s.board[sq('e8')] = 'k'
      s.board[sq(attacker)] = 'b'
      s.castling = 'K'
      return s
    }
    const castle = { type: 'move', from: sq('e1'), to: sq('g1') }
    expect(chessEngine.validateMove(setup('a8'), 0, castle).ok).toBe(true) // bishop far away
    expect(chessEngine.validateMove(setup('b4'), 0, castle).ok).toBe(false) // king in check
    expect(chessEngine.validateMove(setup('c4'), 0, castle).ok).toBe(false) // f1 attacked
    expect(chessEngine.validateMove(setup('d4'), 0, castle).ok).toBe(false) // g1 attacked
  })

  it('captures en passant', () => {
    const s = playAll(fresh(), ['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6'])
    expect(s.board[sq('d5')]).toBeNull()
    expect(s.board[sq('d6')]).toBe('P')
    expect(s.captured[0]).toEqual(['p'])
    expect(s.moves.at(-1)).toBe('exd6')
  })

  it('promotes (defaulting to a queen) and under-promotes on request', () => {
    const line = ['h2h4', 'g7g5', 'h4g5', 'h7h6', 'g5h6', 'a7a6', 'h6h7', 'a6a5']
    const q = playAll(fresh(), [...line, 'h7g8'])
    expect(q.board[sq('g8')]).toBe('Q')
    const n = playAll(fresh(), [...line, 'h7g8n'])
    expect(n.board[sq('g8')]).toBe('N')
    expect(n.moves.at(-1)).toBe('hxg8=N')
  })

  it('declares stalemate and insufficient material as draws', () => {
    const stale = fresh()
    stale.board = Array(64).fill(null)
    stale.board[sq('h8')] = 'k'
    stale.board[sq('f7')] = 'K'
    stale.board[sq('g1')] = 'Q'
    stale.castling = ''
    const s = playAll(stale, ['g1g6'])
    expect(s.result).toEqual({ winnerSeat: null, reason: 'stalemate' })
    expect(chessEngine.getWinner(s)).toEqual({ finished: true, outcome: 'DRAW', winnerSeat: null })

    const bare = fresh()
    bare.board = Array(64).fill(null)
    bare.board[sq('e1')] = 'K'
    bare.board[sq('e8')] = 'k'
    bare.board[sq('d2')] = 'n'
    bare.castling = ''
    expect(playAll(bare, ['e1d2']).result).toEqual({ winnerSeat: null, reason: 'insufficient' })
  })

  it('draws by threefold repetition', () => {
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8']
    const s = playAll(fresh(), [...shuffle, ...shuffle])
    expect(s.result).toEqual({ winnerSeat: null, reason: 'threefold' })
  })

  it('either player can resign, even off-turn', () => {
    const s = fresh()
    const v = chessEngine.validateMove(s, 1, { type: 'resign' })
    expect(v.ok).toBe(true)
    if (v.ok) expect(chessEngine.getWinner(chessEngine.applyMove(s, 1, v.move, seededRng(1)))).toEqual({ finished: true, outcome: 'WIN', winnerSeat: 0 })
  })

  it('bot takes a free queen and finds mate in one', () => {
    const hanging = playAll(fresh(), ['e2e4', 'd7d5', 'd1h5', 'd8d6', 'h5d5'])
    expect(chessEngine.autoMove(hanging, 1, seededRng(3))).toEqual({ type: 'move', from: sq('d6'), to: sq('d5') })
    const mate = playAll(fresh(), ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6'])
    expect(chessEngine.autoMove(mate, 0, seededRng(3))).toEqual({ type: 'move', from: sq('h5'), to: sq('f7') })
  })

  it('move generator matches known perft counts', () => {
    const perft = (pos: Position, depth: number): number => {
      const moves = legalMoves(pos)
      return depth === 1 ? moves.length : moves.reduce((n, m) => n + perft(play(pos, m), depth - 1), 0)
    }
    const fromFen = (fen: string): Position => {
      const [placement, turn, castling, ep] = fen.split(' ')
      const board: (Piece | null)[] = Array(64).fill(null)
      placement.split('/').forEach((row, i) => {
        let f = 0
        for (const ch of row) {
          if (/\d/.test(ch)) f += Number(ch)
          else board[(7 - i) * 8 + f++] = ch as Piece
        }
      })
      return { board, turn: turn === 'w' ? 0 : 1, castling: castling === '-' ? '' : castling, ep: ep === '-' ? null : sq(ep) }
    }
    expect(perft(fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'), 3)).toBe(8902)
    expect(perft(fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -'), 2)).toBe(2039)
    expect(perft(fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -'), 3)).toBe(2812)
    expect(perft(fromFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -'), 2)).toBe(264)
  })

  it('bots can always finish a game', () => {
    const rng = seededRng(11)
    let s = fresh()
    for (let i = 0; i < 3000 && !chessEngine.getWinner(s).finished; i++) {
      const seat = chessEngine.getCurrentSeat(s)!
      const v = chessEngine.validateMove(s, seat, chessEngine.autoMove(s, seat, rng))
      expect(v.ok).toBe(true)
      if (v.ok) s = chessEngine.applyMove(s, seat, v.move, rng)
    }
    expect(chessEngine.getWinner(s).finished).toBe(true)
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
