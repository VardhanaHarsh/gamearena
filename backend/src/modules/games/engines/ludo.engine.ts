import { z } from 'zod'
import { clone, lastStanding, nextActiveSeat, rejectJoin, type BaseState, type GameEngine, type GameEvent, type Rng } from '../engine.js'

/**
 * Ludo rules (server-authoritative).
 *
 * Token progress is measured relative to the owner's start square:
 *   -1        = in the yard
 *   0 … 50    = on the shared 52-square track (absolute square = (START[color] + progress) % 52)
 *   51 … 55   = in the private home column
 *   56        = home (finished) — requires an exact roll
 */
export const COLORS = ['red', 'green', 'yellow', 'blue'] as const
export type Color = (typeof COLORS)[number]
export const START: Record<Color, number> = { red: 0, green: 13, yellow: 26, blue: 39 }
/** Start squares + star squares are safe: tokens there cannot be captured. */
export const SAFE_SQUARES = new Set([0, 8, 13, 21, 26, 34, 39, 47])
export const YARD = -1
export const LAST_TRACK = 50
export const HOME = 56
const MAX_SIXES = 3

export interface LudoState extends BaseState {
  colors: Color[] // colors[seat]
  tokens: number[][] // tokens[seat][0..3] = progress
  turnSeat: number
  phase: 'ROLL' | 'MOVE'
  dice: number | null
  sixesInRow: number
  legalTokens: number[]
  winnerSeat: number | null
  lastAction: { seat: number; kind: 'roll' | 'move' | 'pass'; dice?: number; token?: number; from?: number; to?: number; captured?: { seat: number; token: number }[] } | null
}

const moveSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('roll') }).strict(),
  z.object({ type: z.literal('move'), token: z.number().int().min(0).max(3) }).strict(),
])
type Move = z.infer<typeof moveSchema>

const colorsFor = (n: number): Color[] => (n === 2 ? ['red', 'yellow'] : n === 3 ? ['red', 'green', 'yellow'] : [...COLORS])

export const absoluteSquare = (color: Color, progress: number) => (START[color] + progress) % 52

export function legalTokensFor(s: LudoState, seat: number, dice: number) {
  return s.tokens[seat].flatMap((p, i) => {
    if (p === YARD) return dice === 6 ? [i] : []
    if (p === HOME) return []
    return p + dice <= HOME ? [i] : []
  })
}

function passTurn(s: LudoState, seat: number) {
  s.turnSeat = nextActiveSeat(s, seat)
  s.phase = 'ROLL'
  s.dice = null
  s.sixesInRow = 0
  s.legalTokens = []
}

export const ludoEngine: GameEngine<LudoState, Move> = {
  meta: {
    key: 'ludo',
    name: 'Ludo',
    minPlayers: 2,
    maxPlayers: 4,
    estMinutes: 20,
    tagline: 'The classic race home — roll, capture, and bring all four tokens in.',
    rules: [
      'Roll a 6 to bring a token out of your yard onto your start square.',
      'Move a token forward by the number rolled. The server rolls the dice — clients cannot.',
      'Land on an opponent outside a safe (★/start) square to send it back to its yard.',
      'Rolling a 6, capturing, or bringing a token home earns another roll. Three 6s in a row forfeits the turn.',
      'Tokens enter your home column after one lap and need an exact roll to reach home.',
      'First player to bring all four tokens home wins.',
    ],
    prizeStructure: 'Winner takes the full prize pool (entry fee × players).',
  },
  moveSchema,

  createGame(players) {
    return {
      players,
      forfeited: [],
      moveCount: 0,
      events: [],
      colors: colorsFor(players.length),
      tokens: players.map(() => [YARD, YARD, YARD, YARD]),
      turnSeat: 0,
      phase: 'ROLL',
      dice: null,
      sixesInRow: 0,
      legalTokens: [],
      winnerSeat: null,
      lastAction: null,
    }
  },
  joinGame: rejectJoin,

  validateMove(state, seat, raw) {
    // Any attempt to send a dice value (or other extra field) fails `.strict()` and is flagged.
    const parsed = moveSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'Malformed move.', suspicious: true }
    if (this.getWinner(state).finished) return { ok: false, reason: 'Game is over.' }
    if (seat !== state.turnSeat) return { ok: false, reason: 'Not your turn.' }
    const move = parsed.data
    if (move.type === 'roll' && state.phase !== 'ROLL') return { ok: false, reason: 'You already rolled — move a token.' }
    if (move.type === 'move') {
      if (state.phase !== 'MOVE') return { ok: false, reason: 'Roll the dice first.' }
      if (!state.legalTokens.includes(move.token)) return { ok: false, reason: 'That token cannot move.', suspicious: true }
    }
    return { ok: true, move }
  },

  applyMove(prev, seat, move, rng: Rng) {
    const s = clone(prev)
    s.moveCount++
    const events: GameEvent[] = []

    if (move.type === 'roll') {
      const dice = rng.int(1, 7)
      s.dice = dice
      s.sixesInRow = dice === 6 ? s.sixesInRow + 1 : 0
      events.push({ type: 'dice', seat, value: dice })
      s.lastAction = { seat, kind: 'roll', dice }
      if (s.sixesInRow >= MAX_SIXES) {
        events.push({ type: 'three-sixes', seat })
        s.lastAction = { seat, kind: 'pass', dice }
        passTurn(s, seat)
      } else {
        s.legalTokens = legalTokensFor(s, seat, dice)
        if (s.legalTokens.length === 0) {
          events.push({ type: 'no-move', seat })
          s.lastAction = { seat, kind: 'pass', dice }
          passTurn(s, seat)
        } else s.phase = 'MOVE'
      }
      s.events = events
      return s
    }

    const dice = s.dice!
    const color = s.colors[seat]
    const from = s.tokens[seat][move.token]
    const to = from === YARD ? 0 : from + dice
    s.tokens[seat][move.token] = to
    const captured: { seat: number; token: number }[] = []

    if (to <= LAST_TRACK) {
      const square = absoluteSquare(color, to)
      if (!SAFE_SQUARES.has(square)) {
        s.tokens.forEach((tokens, otherSeat) => {
          if (otherSeat === seat || s.forfeited.includes(otherSeat)) return
          tokens.forEach((p, t) => {
            if (p !== YARD && p <= LAST_TRACK && absoluteSquare(s.colors[otherSeat], p) === square) {
              s.tokens[otherSeat][t] = YARD
              captured.push({ seat: otherSeat, token: t })
            }
          })
        })
      }
    }
    events.push({ type: 'move', seat, token: move.token, from, to })
    if (captured.length) events.push({ type: 'capture', seat, captured })
    if (to === HOME) events.push({ type: 'home', seat, token: move.token })
    s.lastAction = { seat, kind: 'move', dice, token: move.token, from, to, captured }

    if (s.tokens[seat].every((p) => p === HOME)) {
      s.winnerSeat = seat
      s.phase = 'ROLL'
      s.legalTokens = []
      events.push({ type: 'win', seat })
    } else if (dice === 6 || captured.length > 0 || to === HOME) {
      // Bonus roll for the same player.
      s.phase = 'ROLL'
      s.dice = null
      s.legalTokens = []
      if (dice !== 6) s.sixesInRow = 0
      events.push({ type: 'bonus-roll', seat })
    } else passTurn(s, seat)

    s.events = events
    return s
  },

  getState: (s) => s,
  getCurrentSeat: (s) => (s.winnerSeat !== null || lastStanding(s) !== null ? null : s.turnSeat),

  getWinner(s) {
    if (s.winnerSeat !== null) return { finished: true, outcome: 'WIN', winnerSeat: s.winnerSeat }
    const standing = lastStanding(s)
    if (standing !== null && s.forfeited.length) return { finished: true, outcome: 'FORFEIT', winnerSeat: standing }
    return { finished: false }
  },

  endGame(prev, seat) {
    const s = clone(prev)
    if (!s.forfeited.includes(seat)) s.forfeited.push(seat)
    s.tokens[seat] = s.tokens[seat].map(() => YARD)
    if (s.turnSeat === seat) passTurn(s, seat)
    s.events = [{ type: 'forfeit', seat }]
    return s
  },

  /** Used for turn timeouts and practice bots: capture > reach home > leave yard > advance furthest token. */
  autoMove(s, seat) {
    if (s.phase === 'ROLL') return { type: 'roll' }
    const dice = s.dice!
    const color = s.colors[seat]
    const score = (token: number) => {
      const from = s.tokens[seat][token]
      const to = from === YARD ? 0 : from + dice
      let value = from === YARD ? 0 : from
      if (to === HOME) value += 200
      if (from === YARD) value += 120
      if (to <= LAST_TRACK) {
        const sq = absoluteSquare(color, to)
        const captures = !SAFE_SQUARES.has(sq) && s.tokens.some((t, os) => os !== seat && t.some((p) => p !== YARD && p <= LAST_TRACK && absoluteSquare(s.colors[os], p) === sq))
        if (captures) value += 300
        if (SAFE_SQUARES.has(sq)) value += 30
      }
      return value
    }
    const token = [...s.legalTokens].sort((a, b) => score(b) - score(a))[0]
    return token === undefined ? null : { type: 'move', token }
  },
}
