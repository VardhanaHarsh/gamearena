import { z } from 'zod'
import { clone, lastStanding, rejectJoin, type BaseState, type GameEngine } from '../engine.js'

export const ROWS = 6
export const COLS = 7

export interface ConnectFourState extends BaseState {
  /** grid[row][col], row 0 = top */
  grid: (number | null)[][]
  turnSeat: number
  winnerSeat: number | null
  winningCells: [number, number][] | null
  draw: boolean
  lastDrop: { row: number; col: number } | null
}
const moveSchema = z.object({ type: z.literal('drop'), col: z.number().int().min(0).max(COLS - 1) }).strict()
type Move = z.infer<typeof moveSchema>

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]] as const

function landingRow(grid: (number | null)[][], col: number) {
  for (let r = ROWS - 1; r >= 0; r--) if (grid[r][col] === null) return r
  return -1
}

function winningCells(grid: (number | null)[][], row: number, col: number): [number, number][] | null {
  const who = grid[row][col]
  if (who === null) return null
  for (const [dr, dc] of DIRS) {
    const cells: [number, number][] = [[row, col]]
    for (const sign of [1, -1]) {
      let r = row + dr * sign
      let c = col + dc * sign
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && grid[r][c] === who) {
        cells.push([r, c])
        r += dr * sign
        c += dc * sign
      }
    }
    if (cells.length >= 4) return cells
  }
  return null
}

export const connectFourEngine: GameEngine<ConnectFourState, Move> = {
  meta: {
    key: 'connectfour',
    name: 'Connect Four',
    minPlayers: 2,
    maxPlayers: 2,
    estMinutes: 8,
    tagline: 'Drop discs, think ahead, connect four.',
    rules: ['Players take turns dropping a disc into one of 7 columns.', 'Discs fall to the lowest empty slot.', 'First to connect four horizontally, vertically or diagonally wins.', 'A full board is a draw.'],
    prizeStructure: 'Winner takes the full prize pool. Draw: pool is split equally.',
  },
  moveSchema,
  createGame: (players) => ({
    players,
    forfeited: [],
    moveCount: 0,
    events: [],
    grid: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
    turnSeat: 0,
    winnerSeat: null,
    winningCells: null,
    draw: false,
    lastDrop: null,
  }),
  joinGame: rejectJoin,
  validateMove(state, seat, raw) {
    const parsed = moveSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'Malformed move.', suspicious: true }
    if (this.getWinner(state).finished) return { ok: false, reason: 'Game is over.' }
    if (seat !== state.turnSeat) return { ok: false, reason: 'Not your turn.' }
    if (landingRow(state.grid, parsed.data.col) < 0) return { ok: false, reason: 'That column is full.' }
    return { ok: true, move: parsed.data }
  },
  applyMove(prev, seat, move) {
    const s = clone(prev)
    const row = landingRow(s.grid, move.col)
    s.grid[row][move.col] = seat
    s.lastDrop = { row, col: move.col }
    s.events = [{ type: 'drop', seat, row, col: move.col }]
    s.moveCount++
    const cells = winningCells(s.grid, row, move.col)
    if (cells) {
      s.winnerSeat = seat
      s.winningCells = cells
    } else if (s.grid[0].every((c) => c !== null)) s.draw = true
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
    const open = Array.from({ length: COLS }, (_, c) => c).filter((c) => landingRow(s.grid, c) >= 0)
    if (!open.length) return null
    const winsWith = (who: number) =>
      open.find((c) => {
        const g = s.grid.map((r) => [...r])
        const r = landingRow(g, c)
        g[r][c] = who
        return winningCells(g, r, c) !== null
      })
    const preferred = [3, 2, 4, 1, 5, 0, 6].filter((c) => open.includes(c))
    const col = winsWith(seat) ?? winsWith(1 - seat) ?? (rng.float() < 0.7 ? preferred[0] : open[rng.int(0, open.length)])
    return { type: 'drop', col }
  },
}
