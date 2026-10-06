import type { z } from 'zod'

/**
 * GameEngine contract. Engines are PURE and server-side only:
 *  - they never perform I/O, never read the clock and get randomness only from the injected `Rng`;
 *  - `applyMove` returns a NEW state and never mutates its input;
 *  - `validateMove` must be called first — it parses untrusted client input with `moveSchema`
 *    and checks game rules, so a rejected move can never change server state.
 * The GameServer owns timers, persistence, settlement and broadcasting.
 */
export interface Rng {
  int(minInclusive: number, maxExclusive: number): number
  float(): number
}

export interface PlayerRef {
  seat: number
  userId: string | null
  name: string
  isBot: boolean
}

export interface GameMeta {
  key: string
  name: string
  minPlayers: number
  maxPlayers: number
  estMinutes: number
  tagline: string
  rules: string[]
  prizeStructure: string
}

export type WinnerInfo =
  | { finished: false }
  | { finished: true; outcome: 'WIN' | 'FORFEIT'; winnerSeat: number }
  | { finished: true; outcome: 'DRAW'; winnerSeat: null }

export type ValidationResult<M> = { ok: true; move: M } | { ok: false; reason: string; suspicious?: boolean }

/** Optional short-lived effects a client can animate or play sounds for (e.g. "capture", "six"). */
export interface GameEvent {
  type: string
  seat?: number
  [k: string]: unknown
}

export interface BaseState {
  players: PlayerRef[]
  /** Seats that left/forfeited — engines skip them when advancing turns. */
  forfeited: number[]
  moveCount: number
  events: GameEvent[]
}

export interface GameEngine<S extends BaseState = BaseState, M = unknown> {
  readonly meta: GameMeta
  readonly moveSchema: z.ZodType<M>
  createGame(players: PlayerRef[], rng: Rng): S
  /** Seat a player before the first move. Engines with fixed seating may reject. */
  joinGame(state: S, player: PlayerRef): S
  validateMove(state: S, seat: number, move: unknown): ValidationResult<M>
  applyMove(state: S, seat: number, move: M, rng: Rng): S
  /** View of the state sent to `viewerSeat` (null = spectator). Hide private info here if a game has any. */
  getState(state: S, viewerSeat: number | null): unknown
  getCurrentSeat(state: S): number | null
  getWinner(state: S): WinnerInfo
  /** Ends the game for a seat (leave / disconnect timeout). */
  endGame(state: S, forfeitSeat: number): S
  /** Move to play automatically when the current player's turn timer expires, or for bots. */
  autoMove(state: S, seat: number, rng: Rng): M | null
  /**
   * How long clients take to animate the most recent move. The server waits this long before
   * starting the next turn timer / bot move, so slow, readable animations never eat a player's time.
   */
  animationMs?(state: S): number
}

export const clone = <T>(v: T): T => structuredClone(v)

/** Next seat in turn order that has not forfeited. */
export function nextActiveSeat(state: BaseState, from: number) {
  const n = state.players.length
  for (let i = 1; i <= n; i++) {
    const seat = (from + i) % n
    if (!state.forfeited.includes(seat)) return seat
  }
  return from
}

export function lastStanding(state: BaseState): number | null {
  const active = state.players.filter((p) => !state.forfeited.includes(p.seat))
  return active.length === 1 ? active[0].seat : null
}

export const rejectJoin = () => {
  throw new Error('Players are seated when the game starts')
}
