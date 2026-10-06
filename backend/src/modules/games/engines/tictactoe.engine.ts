import { z } from 'zod'
import { clone, lastStanding, rejectJoin, type BaseState, type GameEngine } from '../engine.js'

export interface TicTacToeState extends BaseState {
  board: (number | null)[]
  turnSeat: number
  winnerSeat: number | null
  winningLine: number[] | null
  draw: boolean
}
const moveSchema = z.object({ type: z.literal('place'), cell: z.number().int().min(0).max(8) }).strict()
type Move = z.infer<typeof moveSchema>

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

function findLine(board: (number | null)[]) {
  return LINES.find(([a, b, c]) => board[a] !== null && board[a] === board[b] && board[a] === board[c]) ?? null
}

export const ticTacToeEngine: GameEngine<TicTacToeState, Move> = {
  meta: {
    key: 'tictactoe',
    name: 'Tic-Tac-Toe',
    minPlayers: 2,
    maxPlayers: 2,
    estMinutes: 3,
    tagline: 'Three in a row. Simple to learn, sharp to master.',
    rules: ['Players take turns placing X (first) and O on a 3×3 grid.', 'Three marks in a row, column or diagonal wins.', 'A full board with no line is a draw — the prize pool is split.'],
    prizeStructure: 'Winner takes the full prize pool. Draw: pool is split equally.',
  },
  moveSchema,
  createGame: (players) => ({ players, forfeited: [], moveCount: 0, events: [], board: Array(9).fill(null), turnSeat: 0, winnerSeat: null, winningLine: null, draw: false }),
  joinGame: rejectJoin,
  validateMove(state, seat, raw) {
    const parsed = moveSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'Malformed move.', suspicious: true }
    if (this.getWinner(state).finished) return { ok: false, reason: 'Game is over.' }
    if (seat !== state.turnSeat) return { ok: false, reason: 'Not your turn.' }
    if (state.board[parsed.data.cell] !== null) return { ok: false, reason: 'That cell is taken.', suspicious: true }
    return { ok: true, move: parsed.data }
  },
  applyMove(prev, seat, move) {
    const s = clone(prev)
    s.events = [{ type: 'place', seat, cell: move.cell }]
    s.board[move.cell] = seat
    s.moveCount++
    const line = findLine(s.board)
    if (line) {
      s.winnerSeat = seat
      s.winningLine = line
    } else if (s.board.every((c) => c !== null)) s.draw = true
    else s.turnSeat = 1 - seat
    return s
  },
  getState: (s) => s,
  getCurrentSeat: (s) => (s.winnerSeat !== null || s.draw || lastStanding(s) !== null ? null : s.turnSeat),
  getWinner(s) {
    const standing = lastStanding(s)
    if (standing !== null && s.forfeited.length) return { finished: true, outcome: 'FORFEIT', winnerSeat: standing }
    if (s.winnerSeat !== null) return { finished: true, outcome: 'WIN', winnerSeat: s.winnerSeat }
    if (s.draw) return { finished: true, outcome: 'DRAW', winnerSeat: null }
    return { finished: false }
  },
  endGame(prev, seat) {
    const s = clone(prev)
    if (!s.forfeited.includes(seat)) s.forfeited.push(seat)
    return s
  },
  autoMove(s, seat, rng) {
    const empty = s.board.flatMap((c, i) => (c === null ? [i] : []))
    if (!empty.length) return null
    const winsWith = (who: number) =>
      empty.find((i) => {
        const b = [...s.board]
        b[i] = who
        return findLine(b) !== null
      })
    const cell = winsWith(seat) ?? winsWith(1 - seat) ?? (empty.includes(4) ? 4 : empty[rng.int(0, empty.length)])
    return { type: 'place', cell }
  },
}
