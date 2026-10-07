import { z } from 'zod'
import { clone, lastStanding, rejectJoin, type BaseState, type GameEngine, type Rng } from '../engine.js'

/**
 * Chess. Seat 0 plays White, seat 1 plays Black.
 * Squares are 0..63 with `sq = rank * 8 + file` (a1 = 0, h1 = 7, a8 = 56, h8 = 63).
 * Pieces use FEN letters: uppercase = White, lowercase = Black.
 */
export type Piece = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
type Promo = 'q' | 'r' | 'b' | 'n'
type Board = (Piece | null)[]

export type ChessResultReason = 'checkmate' | 'stalemate' | 'threefold' | 'fifty-move' | 'insufficient' | 'resignation'

export interface ChessState extends BaseState {
  board: Board
  turnSeat: number
  /** Remaining castling rights, a subset of "KQkq". */
  castling: string
  /** En-passant target square (the square the capturing pawn lands on), if any. */
  ep: number | null
  halfmoveClock: number
  /** Occurrences of each position since the last irreversible move (threefold repetition). */
  positions: Record<string, number>
  /** SAN of every move played, in order. */
  moves: string[]
  lastMove: { from: number; to: number; san: string } | null
  /** Pieces each seat has captured. */
  captured: [Piece[], Piece[]]
  check: boolean
  result: { winnerSeat: number | null; reason: ChessResultReason } | null
}

const moveSchema = z.union([
  z
    .object({
      type: z.literal('move'),
      from: z.number().int().min(0).max(63),
      to: z.number().int().min(0).max(63),
      promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
    })
    .strict(),
  z.object({ type: z.literal('resign') }).strict(),
])
type Move = z.infer<typeof moveSchema>

interface InternalMove {
  from: number
  to: number
  promotion?: Promo
  capture: Piece | null
  enPassant?: boolean
  castle?: 'K' | 'Q'
}

export interface Position {
  board: Board
  turn: number
  castling: string
  ep: number | null
}

const FILES = 'abcdefgh'
export const squareName = (sq: number) => `${FILES[sq % 8]}${Math.floor(sq / 8) + 1}`
const fileOf = (sq: number) => sq % 8
const rankOf = (sq: number) => Math.floor(sq / 8)
const colorOf = (p: Piece) => (p === p.toUpperCase() ? 0 : 1)
const typeOf = (p: Piece) => p.toLowerCase() as Lowercase<Piece>
const make = (type: string, color: number) => (color === 0 ? type.toUpperCase() : type.toLowerCase()) as Piece

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const

/** Square offset by (df, dr), or -1 if it leaves the board. */
function step(sq: number, df: number, dr: number) {
  const f = fileOf(sq) + df
  const r = rankOf(sq) + dr
  return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f
}

export function initialBoard(): Board {
  const b: Board = Array(64).fill(null)
  const back = 'rnbqkbnr'
  for (let f = 0; f < 8; f++) {
    b[f] = make(back[f], 0)
    b[8 + f] = 'P'
    b[48 + f] = 'p'
    b[56 + f] = make(back[f], 1)
  }
  return b
}

export function isAttacked(board: Board, sq: number, by: number): boolean {
  // Pawns attack diagonally forward, so look one rank "behind" sq from the attacker's view.
  const pawnRank = by === 0 ? -1 : 1
  for (const df of [-1, 1]) {
    const s = step(sq, df, pawnRank)
    if (s >= 0 && board[s] === make('p', by)) return true
  }
  for (const [df, dr] of KNIGHT) {
    const s = step(sq, df, dr)
    if (s >= 0 && board[s] === make('n', by)) return true
  }
  for (const [df, dr] of KING) {
    const s = step(sq, df, dr)
    if (s >= 0 && board[s] === make('k', by)) return true
  }
  const slide = (dirs: readonly (readonly [number, number])[], types: string) => {
    for (const [df, dr] of dirs) {
      let s = step(sq, df, dr)
      while (s >= 0) {
        const p = board[s]
        if (p) {
          if (colorOf(p) === by && types.includes(typeOf(p))) return true
          break
        }
        s = step(s, df, dr)
      }
    }
    return false
  }
  return slide(ROOK_DIRS, 'rq') || slide(BISHOP_DIRS, 'bq')
}

const kingSquare = (board: Board, color: number) => board.indexOf(make('k', color))
const inCheck = (board: Board, color: number) => isAttacked(board, kingSquare(board, color), 1 - color)

function pseudoMoves(pos: Position): InternalMove[] {
  const { board, turn } = pos
  const out: InternalMove[] = []
  const add = (from: number, to: number, extra: Partial<InternalMove> = {}) => out.push({ from, to, capture: board[to], ...extra })
  for (let from = 0; from < 64; from++) {
    const p = board[from]
    if (!p || colorOf(p) !== turn) continue
    const t = typeOf(p)
    if (t === 'p') {
      const dir = turn === 0 ? 1 : -1
      const startRank = turn === 0 ? 1 : 6
      const lastRank = turn === 0 ? 7 : 0
      const pushPromo = (to: number, extra: Partial<InternalMove> = {}) => {
        if (rankOf(to) === lastRank) for (const promotion of ['q', 'r', 'b', 'n'] as const) add(from, to, { ...extra, promotion })
        else add(from, to, extra)
      }
      const one = step(from, 0, dir)
      if (one >= 0 && !board[one]) {
        pushPromo(one)
        const two = step(from, 0, 2 * dir)
        if (rankOf(from) === startRank && !board[two]) add(from, two)
      }
      for (const df of [-1, 1]) {
        const to = step(from, df, dir)
        if (to < 0) continue
        const target = board[to]
        if (target && colorOf(target) !== turn) pushPromo(to)
        else if (to === pos.ep) add(from, to, { enPassant: true, capture: make('p', 1 - turn) })
      }
    } else if (t === 'n' || t === 'k') {
      for (const [df, dr] of t === 'n' ? KNIGHT : KING) {
        const to = step(from, df, dr)
        if (to >= 0 && (!board[to] || colorOf(board[to]!) !== turn)) add(from, to)
      }
      if (t === 'k') {
        const home = turn === 0 ? 4 : 60
        const [kSide, qSide] = turn === 0 ? ['K', 'Q'] : ['k', 'q']
        if (from === home && !isAttacked(board, home, 1 - turn)) {
          if (pos.castling.includes(kSide) && !board[home + 1] && !board[home + 2] && !isAttacked(board, home + 1, 1 - turn))
            add(from, home + 2, { castle: 'K' })
          if (pos.castling.includes(qSide) && !board[home - 1] && !board[home - 2] && !board[home - 3] && !isAttacked(board, home - 1, 1 - turn))
            add(from, home - 2, { castle: 'Q' })
        }
      }
    } else {
      const dirs = t === 'r' ? ROOK_DIRS : t === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS]
      for (const [df, dr] of dirs) {
        let to = step(from, df, dr)
        while (to >= 0) {
          if (board[to]) {
            if (colorOf(board[to]!) !== turn) add(from, to)
            break
          }
          add(from, to)
          to = step(to, df, dr)
        }
      }
    }
  }
  return out
}

/** Plays a move on a position (no legality check). Returns a new position. */
export function play(pos: Position, m: InternalMove): Position {
  const board = [...pos.board]
  const piece = board[m.from]!
  const turn = pos.turn
  board[m.to] = m.promotion ? make(m.promotion, turn) : piece
  board[m.from] = null
  if (m.enPassant) board[m.to - (turn === 0 ? 8 : -8)] = null
  if (m.castle) {
    const home = turn === 0 ? 4 : 60
    const [rookFrom, rookTo] = m.castle === 'K' ? [home + 3, home + 1] : [home - 4, home - 1]
    board[rookTo] = board[rookFrom]
    board[rookFrom] = null
  }
  let castling = pos.castling
  const strip = (chars: string) => (castling = castling.replace(new RegExp(`[${chars}]`, 'g'), ''))
  if (piece === 'K') strip('KQ')
  if (piece === 'k') strip('kq')
  for (const sq of [m.from, m.to]) {
    if (sq === 0) strip('Q')
    if (sq === 7) strip('K')
    if (sq === 56) strip('q')
    if (sq === 63) strip('k')
  }
  const ep = typeOf(piece) === 'p' && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : null
  return { board, turn: 1 - turn, castling, ep }
}

export function legalMoves(pos: Position): InternalMove[] {
  return pseudoMoves(pos).filter((m) => !inCheck(play(pos, m).board, pos.turn))
}

const positionKey = (p: Position) => `${p.board.map((x) => x ?? '.').join('')}|${p.turn}|${p.castling}|${p.ep ?? '-'}`
const toPosition = (s: ChessState): Position => ({ board: s.board, turn: s.turnSeat, castling: s.castling, ep: s.ep })

function insufficientMaterial(board: Board) {
  const pieces = board.map((p, sq) => ({ p, sq })).filter((x): x is { p: Piece; sq: number } => x.p !== null && typeOf(x.p) !== 'k')
  if (pieces.length === 0) return true
  if (pieces.length === 1) return 'nb'.includes(typeOf(pieces[0].p))
  // Only bishops, all on the same colour of square.
  if (pieces.every((x) => typeOf(x.p) === 'b')) {
    const shade = (sq: number) => (fileOf(sq) + rankOf(sq)) % 2
    return pieces.every((x) => shade(x.sq) === shade(pieces[0].sq))
  }
  return false
}

function san(pos: Position, m: InternalMove, all: InternalMove[]): string {
  const piece = pos.board[m.from]!
  const t = typeOf(piece)
  let s: string
  if (m.castle) s = m.castle === 'K' ? 'O-O' : 'O-O-O'
  else if (t === 'p') {
    s = m.capture ? `${FILES[fileOf(m.from)]}x${squareName(m.to)}` : squareName(m.to)
    if (m.promotion) s += `=${m.promotion.toUpperCase()}`
  } else {
    const rivals = all.filter((o) => o.to === m.to && o.from !== m.from && pos.board[o.from] === piece)
    let dis = ''
    if (rivals.length) {
      if (rivals.every((o) => fileOf(o.from) !== fileOf(m.from))) dis = FILES[fileOf(m.from)]
      else if (rivals.every((o) => rankOf(o.from) !== rankOf(m.from))) dis = String(rankOf(m.from) + 1)
      else dis = squareName(m.from)
    }
    s = `${t.toUpperCase()}${dis}${m.capture ? 'x' : ''}${squareName(m.to)}`
  }
  const next = play(pos, m)
  if (inCheck(next.board, next.turn)) s += legalMoves(next).length ? '+' : '#'
  return s
}

// ── Bot ───────────────────────────────────────────────────────────────────────
const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 }
/** Small positional bonus: pieces towards the centre, pawns for advancing. */
function evaluate(board: Board, color: number) {
  let score = 0
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq]
    if (!p) continue
    const t = typeOf(p)
    const f = fileOf(sq)
    const r = rankOf(sq)
    const centre = 7 - (Math.abs(3.5 - f) + Math.abs(3.5 - r)) * 2
    let v = VALUE[t]
    if (t === 'n' || t === 'b') v += centre * 3
    else if (t === 'q') v += centre
    else if (t === 'p') v += (colorOf(p) === 0 ? r - 1 : 6 - r) * 6 + (f >= 2 && f <= 5 ? 4 : 0)
    score += colorOf(p) === color ? v : -v
  }
  return score
}

const MATE = 100_000
/** Negamax with alpha-beta, scored from the side to move's point of view. */
function search(pos: Position, depth: number, alpha: number, beta: number): number {
  const checked = inCheck(pos.board, pos.turn)
  // Leaves only generate moves when in check (to spot mate) — full generation everywhere is too slow.
  if (depth === 0 && !checked) return evaluate(pos.board, pos.turn)
  const moves = legalMoves(pos)
  if (!moves.length) return checked ? -MATE - depth : 0
  if (depth === 0) return evaluate(pos.board, pos.turn)
  moves.sort((a, b) => (b.capture ? VALUE[typeOf(b.capture)] : 0) - (a.capture ? VALUE[typeOf(a.capture)] : 0))
  for (const m of moves) {
    const score = -search(play(pos, m), depth - 1, -beta, -alpha)
    if (score >= beta) return beta
    if (score > alpha) alpha = score
  }
  return alpha
}

function botMove(pos: Position, rng: Rng): InternalMove | null {
  const moves = legalMoves(pos)
  if (!moves.length) return null
  let best: InternalMove[] = []
  let bestScore = -Infinity
  for (const m of moves) {
    // Depth 2 replies: sees immediate threats and hanging pieces; a little noise keeps games varied.
    const score = -search(play(pos, m), 1, -Infinity, Infinity) + rng.float() * 12
    if (score > bestScore + 0.5) {
      best = [m]
      bestScore = score
    } else if (Math.abs(score - bestScore) <= 0.5) best.push(m)
  }
  return best[rng.int(0, best.length)]
}

// ── Engine ────────────────────────────────────────────────────────────────────
function findMove(s: ChessState, move: Extract<Move, { type: 'move' }>) {
  return legalMoves(toPosition(s)).find((m) => m.from === move.from && m.to === move.to && (m.promotion ?? null) === (move.promotion ?? (m.promotion ? 'q' : null)))
}

export const chessEngine: GameEngine<ChessState, Move> = {
  meta: {
    key: 'chess',
    name: 'Chess',
    minPlayers: 2,
    maxPlayers: 2,
    estMinutes: 30,
    tagline: 'The ultimate strategy duel.',
    rules: [
      'Seat 1 plays White and moves first; seat 2 plays Black.',
      'All standard rules apply: castling, en passant and pawn promotion (choose queen, rook, bishop or knight).',
      'Checkmate your opponent to win. You may resign at any time.',
      'Stalemate, threefold repetition, the 50-move rule and insufficient material are draws.',
      'If your turn timer runs out, a move is played for you.',
    ],
    prizeStructure: 'Winner takes the full prize pool. Draw: pool is split equally.',
  },
  moveSchema,
  createGame(players) {
    const s: ChessState = {
      players,
      forfeited: [],
      moveCount: 0,
      events: [],
      board: initialBoard(),
      turnSeat: 0,
      castling: 'KQkq',
      ep: null,
      halfmoveClock: 0,
      positions: {},
      moves: [],
      lastMove: null,
      captured: [[], []],
      check: false,
      result: null,
    }
    s.positions[positionKey(toPosition(s))] = 1
    return s
  },
  joinGame: rejectJoin,
  validateMove(state, seat, raw) {
    const parsed = moveSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'Malformed move.', suspicious: true }
    if (this.getWinner(state).finished) return { ok: false, reason: 'Game is over.' }
    if (parsed.data.type === 'resign') return state.players.some((p) => p.seat === seat) ? { ok: true, move: parsed.data } : { ok: false, reason: 'Not a player.' }
    if (seat !== state.turnSeat) return { ok: false, reason: 'Not your turn.' }
    const piece = state.board[parsed.data.from]
    if (!piece || colorOf(piece) !== seat) return { ok: false, reason: 'Pick one of your own pieces.' }
    if (!findMove(state, parsed.data)) return { ok: false, reason: 'Illegal move.' }
    return { ok: true, move: parsed.data }
  },
  applyMove(prev, seat, move) {
    const s = clone(prev)
    s.moveCount++
    if (move.type === 'resign') {
      s.result = { winnerSeat: 1 - seat, reason: 'resignation' }
      s.events = [{ type: 'resign', seat }]
      return s
    }
    const pos = toPosition(s)
    const all = legalMoves(pos)
    const m = findMove(s, move)!
    const notation = san(pos, m, all)
    const next = play(pos, m)
    const irreversible = !!m.capture || typeOf(s.board[m.from]!) === 'p'

    s.board = next.board
    s.turnSeat = next.turn
    s.castling = next.castling
    s.ep = next.ep
    s.halfmoveClock = irreversible ? 0 : s.halfmoveClock + 1
    if (irreversible) s.positions = {}
    const key = positionKey(next)
    s.positions[key] = (s.positions[key] ?? 0) + 1
    if (m.capture) s.captured[seat].push(m.capture)
    s.moves.push(notation)
    s.lastMove = { from: m.from, to: m.to, san: notation }
    s.check = inCheck(next.board, next.turn)
    s.events = [{ type: m.capture ? 'capture' : m.castle ? 'castle' : 'move', seat, from: m.from, to: m.to, san: notation }]
    if (s.check) s.events.push({ type: 'check', seat: next.turn })

    const replies = legalMoves(next)
    if (!replies.length) s.result = s.check ? { winnerSeat: seat, reason: 'checkmate' } : { winnerSeat: null, reason: 'stalemate' }
    else if (insufficientMaterial(next.board)) s.result = { winnerSeat: null, reason: 'insufficient' }
    else if (s.positions[key] >= 3) s.result = { winnerSeat: null, reason: 'threefold' }
    else if (s.halfmoveClock >= 100) s.result = { winnerSeat: null, reason: 'fifty-move' }
    return s
  },
  getState(s, viewerSeat) {
    // Legal moves are sent only to the player on turn so the board can highlight destinations.
    const legal: Record<number, number[]> = {}
    if (!s.result && viewerSeat === s.turnSeat && lastStanding(s) === null)
      for (const m of legalMoves(toPosition(s))) (legal[m.from] ??= []).includes(m.to) || legal[m.from].push(m.to)
    const { positions: _positions, ...view } = s
    return { ...view, legal }
  },
  getCurrentSeat: (s) => (s.result || lastStanding(s) !== null ? null : s.turnSeat),
  getWinner(s) {
    const standing = lastStanding(s)
    if (standing !== null && s.forfeited.length) return { finished: true, outcome: 'FORFEIT', winnerSeat: standing }
    if (!s.result) return { finished: false }
    if (s.result.winnerSeat === null) return { finished: true, outcome: 'DRAW', winnerSeat: null }
    return { finished: true, outcome: 'WIN', winnerSeat: s.result.winnerSeat }
  },
  endGame(prev, seat) {
    const s = clone(prev)
    if (!s.forfeited.includes(seat)) s.forfeited.push(seat)
    return s
  },
  autoMove(s, seat, rng) {
    if (seat !== s.turnSeat) return null
    const m = botMove(toPosition(s), rng)
    return m ? { type: 'move', from: m.from, to: m.to, ...(m.promotion && { promotion: m.promotion }) } : null
  },
  animationMs: () => 300,
}
