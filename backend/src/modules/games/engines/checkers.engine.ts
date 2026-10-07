import { z } from 'zod'
import { clone, lastStanding, rejectJoin, type BaseState, type GameEngine, type Rng } from '../engine.js'

/**
 * Checkers (American / English draughts, 8×8). Seat 0 plays Red from the bottom and moves first;
 * seat 1 plays Black from the top. Squares are 0..63 with `sq = row * 8 + col`, row 0 at Red's side.
 * Only dark squares ((row + col) even) are used.
 */
export interface Man {
  seat: number
  king: boolean
}
type Board = (Man | null)[]

export type CheckersResultReason = 'no-pieces' | 'no-moves' | 'forty-move' | 'resignation'

export interface CheckersState extends BaseState {
  board: Board
  turnSeat: number
  /** Set mid multi-jump: the piece that must keep capturing this turn. */
  chainFrom: number | null
  /** Plies since the last capture or man (non-king) move — 80 means a draw. */
  quietPlies: number
  /** Human-readable move log, e.g. "c3-d4", "e3xc5xa7". */
  moves: string[]
  lastMove: { path: number[]; captured: number[]; crowned: boolean } | null
  /** Opponent pieces each seat has captured. */
  captured: [number, number]
  result: { winnerSeat: number | null; reason: CheckersResultReason } | null
}

const moveSchema = z.union([
  z.object({ type: z.literal('move'), from: z.number().int().min(0).max(63), to: z.number().int().min(0).max(63) }).strict(),
  z.object({ type: z.literal('resign') }).strict(),
])
type Move = z.infer<typeof moveSchema>

interface Step {
  from: number
  to: number
  /** Square of the jumped piece, for captures. */
  over?: number
}

export const QUIET_LIMIT = 80
const DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const
const FILES = 'abcdefgh'
export const squareName = (sq: number) => `${FILES[sq % 8]}${Math.floor(sq / 8) + 1}`
const rowOf = (sq: number) => Math.floor(sq / 8)
const colOf = (sq: number) => sq % 8
const forward = (seat: number) => (seat === 0 ? 1 : -1)
const crownRow = (seat: number) => (seat === 0 ? 7 : 0)

function offset(sq: number, dr: number, dc: number) {
  const r = rowOf(sq) + dr
  const c = colOf(sq) + dc
  return r < 0 || r > 7 || c < 0 || c > 7 ? -1 : r * 8 + c
}

export function initialBoard(): Board {
  const b: Board = Array(64).fill(null)
  for (let sq = 0; sq < 64; sq++) {
    if ((rowOf(sq) + colOf(sq)) % 2 !== 0) continue
    if (rowOf(sq) <= 2) b[sq] = { seat: 0, king: false }
    else if (rowOf(sq) >= 5) b[sq] = { seat: 1, king: false }
  }
  return b
}

function pieceSteps(board: Board, from: number): { moves: Step[]; jumps: Step[] } {
  const p = board[from]!
  const moves: Step[] = []
  const jumps: Step[] = []
  for (const [dr, dc] of DIAGONALS) {
    if (!p.king && dr !== forward(p.seat)) continue
    const to = offset(from, dr, dc)
    if (to < 0) continue
    if (!board[to]) moves.push({ from, to })
    else if (board[to]!.seat !== p.seat) {
      const land = offset(to, dr, dc)
      if (land >= 0 && !board[land]) jumps.push({ from, to: land, over: to })
    }
  }
  return { moves, jumps }
}

/** Legal single steps for `seat`. Captures are compulsory; mid-chain only the chaining piece may jump. */
export function legalSteps(board: Board, seat: number, chainFrom: number | null = null): Step[] {
  if (chainFrom !== null) return pieceSteps(board, chainFrom).jumps
  const moves: Step[] = []
  const jumps: Step[] = []
  for (let sq = 0; sq < 64; sq++) {
    if (board[sq]?.seat !== seat) continue
    const s = pieceSteps(board, sq)
    moves.push(...s.moves)
    jumps.push(...s.jumps)
  }
  return jumps.length ? jumps : moves
}

/** Applies one step. Returns the new board, whether the piece was crowned and whether it must keep jumping. */
function applyStep(board: Board, step: Step) {
  const b = [...board]
  const piece = { ...b[step.from]! }
  b[step.from] = null
  if (step.over !== undefined) b[step.over] = null
  const crowned = !piece.king && rowOf(step.to) === crownRow(piece.seat)
  if (crowned) piece.king = true
  b[step.to] = piece
  // Crowning ends the turn, even if further jumps would be possible.
  const continues = step.over !== undefined && !crowned && pieceSteps(b, step.to).jumps.length > 0
  return { board: b, crowned, continues }
}

// ── Bot ───────────────────────────────────────────────────────────────────────
interface Turn {
  steps: Step[]
  board: Board
}

/** Every complete turn (whole multi-jump chains) available to `seat`. */
function fullTurns(board: Board, seat: number, chainFrom: number | null = null): Turn[] {
  const out: Turn[] = []
  const extend = (b: Board, steps: Step[], from: number | null) => {
    for (const step of legalSteps(b, seat, from)) {
      const r = applyStep(b, step)
      if (r.continues) extend(r.board, [...steps, step], step.to)
      else out.push({ steps: [...steps, step], board: r.board })
    }
  }
  extend(board, [], chainFrom)
  return out
}

function evaluate(board: Board, seat: number) {
  let score = 0
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq]
    if (!p) continue
    const advance = p.seat === 0 ? rowOf(sq) : 7 - rowOf(sq)
    const centre = colOf(sq) >= 2 && colOf(sq) <= 5 ? 3 : 0
    // Men left on the back row guard against enemy crowning.
    const guard = !p.king && advance === 0 ? 4 : 0
    const v = p.king ? 175 : 100 + advance * 4 + centre + guard
    score += p.seat === seat ? v : -v
  }
  return score
}

const WIN = 100_000
function search(board: Board, seat: number, depth: number, alpha: number, beta: number): number {
  const turns = fullTurns(board, seat)
  if (!turns.length) return -WIN - depth
  if (depth === 0) return evaluate(board, seat)
  for (const t of turns) {
    const score = -search(t.board, 1 - seat, depth - 1, -beta, -alpha)
    if (score >= beta) return beta
    if (score > alpha) alpha = score
  }
  return alpha
}

function botStep(s: CheckersState, rng: Rng): Step | null {
  const turns = fullTurns(s.board, s.turnSeat, s.chainFrom)
  if (!turns.length) return null
  let best: Turn[] = []
  let bestScore = -Infinity
  for (const t of turns) {
    const score = -search(t.board, 1 - s.turnSeat, 3, -Infinity, Infinity) + rng.float() * 10
    if (score > bestScore + 0.5) {
      best = [t]
      bestScore = score
    } else if (Math.abs(score - bestScore) <= 0.5) best.push(t)
  }
  return best[rng.int(0, best.length)].steps[0]
}

// ── Engine ────────────────────────────────────────────────────────────────────
const findStep = (s: CheckersState, from: number, to: number) => legalSteps(s.board, s.turnSeat, s.chainFrom).find((st) => st.from === from && st.to === to)

export const checkersEngine: GameEngine<CheckersState, Move> = {
  meta: {
    key: 'checkers',
    name: 'Checkers',
    minPlayers: 2,
    maxPlayers: 2,
    estMinutes: 15,
    tagline: 'Jump, capture and crown your kings.',
    rules: [
      'Seat 1 plays Red and moves first; seat 2 plays Black. Pieces move diagonally on dark squares.',
      'Men move one square forward; kings move one square in any diagonal direction.',
      'Captures are compulsory. After a jump, the same piece keeps jumping while it can.',
      'A man reaching the far row is crowned a king, which ends the turn.',
      'Win by capturing or blocking every enemy piece. You may resign at any time.',
      '40 moves each without a capture or a man moving is a draw.',
    ],
    prizeStructure: 'Winner takes the full prize pool. Draw: pool is split equally.',
  },
  moveSchema,
  createGame: (players) => ({
    players,
    forfeited: [],
    moveCount: 0,
    events: [],
    board: initialBoard(),
    turnSeat: 0,
    chainFrom: null,
    quietPlies: 0,
    moves: [],
    lastMove: null,
    captured: [0, 0],
    result: null,
  }),
  joinGame: rejectJoin,
  validateMove(state, seat, raw) {
    const parsed = moveSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'Malformed move.', suspicious: true }
    if (this.getWinner(state).finished) return { ok: false, reason: 'Game is over.' }
    if (parsed.data.type === 'resign') return state.players.some((p) => p.seat === seat) ? { ok: true, move: parsed.data } : { ok: false, reason: 'Not a player.' }
    if (seat !== state.turnSeat) return { ok: false, reason: 'Not your turn.' }
    if (state.board[parsed.data.from]?.seat !== seat) return { ok: false, reason: 'Pick one of your own pieces.' }
    if (!findStep(state, parsed.data.from, parsed.data.to)) {
      const mustJump = state.chainFrom !== null || legalSteps(state.board, seat).some((st) => st.over !== undefined)
      return { ok: false, reason: state.chainFrom !== null ? 'Keep jumping with the same piece.' : mustJump ? 'A capture is available — you must take it.' : 'Illegal move.' }
    }
    return { ok: true, move: parsed.data }
  },
  applyMove(prev, seat, move) {
    const s = clone(prev)
    s.moveCount++
    if (move.type === 'resign') {
      s.result = { winnerSeat: 1 - seat, reason: 'resignation' }
      s.chainFrom = null
      s.events = [{ type: 'resign', seat }]
      return s
    }
    const step = findStep(s, move.from, move.to)!
    const wasMan = !s.board[step.from]!.king
    const r = applyStep(s.board, step)
    const capture = step.over !== undefined
    s.board = r.board

    // A multi-jump extends the previous log entry and the last-move path.
    if (s.chainFrom !== null && s.lastMove) {
      s.lastMove.path.push(step.to)
      s.lastMove.captured.push(step.over!)
      s.lastMove.crowned = r.crowned
      s.moves[s.moves.length - 1] += `x${squareName(step.to)}`
    } else {
      s.lastMove = { path: [step.from, step.to], captured: capture ? [step.over!] : [], crowned: r.crowned }
      s.moves.push(`${squareName(step.from)}${capture ? 'x' : '-'}${squareName(step.to)}`)
    }
    if (capture) s.captured[seat]++
    s.events = [{ type: capture ? 'capture' : 'move', seat, from: step.from, to: step.to }]
    if (r.crowned) s.events.push({ type: 'crown', seat, square: step.to })

    if (r.continues) {
      s.chainFrom = step.to
      return s
    }
    s.chainFrom = null
    s.turnSeat = 1 - seat
    s.quietPlies = capture || wasMan ? 0 : s.quietPlies + 1
    const opponentPieces = s.board.some((p) => p?.seat === s.turnSeat)
    if (!opponentPieces) s.result = { winnerSeat: seat, reason: 'no-pieces' }
    else if (!legalSteps(s.board, s.turnSeat).length) s.result = { winnerSeat: seat, reason: 'no-moves' }
    else if (s.quietPlies >= QUIET_LIMIT) s.result = { winnerSeat: null, reason: 'forty-move' }
    return s
  },
  getState(s, viewerSeat) {
    // Legal destinations are sent only to the player on turn so the board can highlight them.
    const legal: Record<number, number[]> = {}
    let mustCapture = false
    if (!s.result && viewerSeat === s.turnSeat && lastStanding(s) === null) {
      for (const st of legalSteps(s.board, s.turnSeat, s.chainFrom)) {
        ;(legal[st.from] ??= []).push(st.to)
        if (st.over !== undefined) mustCapture = true
      }
    }
    return { ...s, legal, mustCapture }
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
    const step = botStep(s, rng)
    return step ? { type: 'move', from: step.from, to: step.to } : null
  },
  animationMs: () => 300,
}
