import { z } from 'zod'
import { clone, lastStanding, rejectJoin, type BaseState, type GameEngine, type GameEvent, type Rng } from '../engine.js'

/**
 * Carrom with a deterministic, server-side 2D physics simulation.
 *
 * The client only sends shot PARAMETERS (striker position on the baseline, angle, power).
 * The server validates them, simulates the shot to rest, applies scoring, and returns the
 * resulting positions plus sampled animation frames. Clients animate those frames — they never
 * compute positions or scores themselves.
 *
 * Board units: 100 × 100 playing surface, origin top-left, y grows downward.
 */
export const BOARD = 100
export const COIN_R = 1.7
export const STRIKER_R = 2.3
export const POCKET_R = 4.2
export const POCKETS = [
  [3.2, 3.2],
  [BOARD - 3.2, 3.2],
  [3.2, BOARD - 3.2],
  [BOARD - 3.2, BOARD - 3.2],
] as const
/** Seat 0 shoots from the bottom baseline, seat 1 from the top. */
export const BASELINE_Y = [82, 18] as const
export const BASELINE_X = [22, 78] as const
export const MAX_SHOTS = 60
const MAX_SPEED = 170 // units / second at power 1
const DT = 1 / 240
const MAX_STEPS = 240 * 12
const FRAME_EVERY = 8 // → 30 fps animation
const FRICTION = 1.15 // proportional damping per second
const ROLLING_DECEL = 9 // constant deceleration (units/s²)
const BALL_RESTITUTION = 0.93
const WALL_RESTITUTION = 0.72
const STOP_SPEED = 0.6

export type CoinKind = 'white' | 'black' | 'queen'
export interface Coin {
  id: number
  kind: CoinKind
  x: number
  y: number
  pocketed: boolean
}

export interface CarromState extends BaseState {
  coins: Coin[]
  scores: [number, number]
  turnSeat: number
  shots: number
  /** Seat that pocketed the queen and must "cover" it with one of its own coins on the same or next shot. */
  queenPendingSeat: number | null
  winnerSeat: number | null
  draw: boolean
  lastShot: {
    seat: number
    striker: { x: number; y: number; angle: number; power: number }
    pocketed: number[]
    strikerPocketed: boolean
    /** frames[i] = flat [strikerX, strikerY, coin0X, coin0Y, …]; -1 marks a pocketed body. */
    frames: number[][]
    summary: string
  } | null
}

export const ownKind = (seat: number): CoinKind => (seat === 0 ? 'white' : 'black')

const moveSchema = z
  .object({
    type: z.literal('shot'),
    position: z.number().min(0).max(1), // along the baseline
    angle: z.number().min(-Math.PI).max(Math.PI),
    power: z.number().min(0.05).max(1),
  })
  .strict()
type Move = z.infer<typeof moveSchema>

export const strikerX = (position: number) => BASELINE_X[0] + position * (BASELINE_X[1] - BASELINE_X[0])

function initialCoins(): Coin[] {
  const coins: Coin[] = [{ id: 0, kind: 'queen', x: 50, y: 50, pocketed: false }]
  const ring = (count: number, radius: number, offset: number) => {
    for (let i = 0; i < count; i++) {
      const a = offset + (i / count) * Math.PI * 2
      coins.push({ id: coins.length, kind: i % 2 === 0 ? 'white' : 'black', x: round(50 + Math.cos(a) * radius), y: round(50 + Math.sin(a) * radius), pocketed: false })
    }
  }
  ring(6, COIN_R * 2.05, Math.PI / 6)
  ring(12, COIN_R * 4.1, 0)
  return coins
}

const round = (v: number) => Math.round(v * 100) / 100

interface Body {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  m: number
  pocketed: boolean
}

/** Advances all bodies until they stop. Pure function of its inputs (deterministic). */
export function simulate(start: { x: number; y: number; vx: number; vy: number }, coins: Coin[]) {
  const bodies: Body[] = [
    { ...start, r: STRIKER_R, m: 2.2, pocketed: false },
    ...coins.map((c) => ({ x: c.x, y: c.y, vx: 0, vy: 0, r: COIN_R, m: 1, pocketed: c.pocketed })),
  ]
  const frames: number[][] = []
  const snapshot = () => frames.push(bodies.flatMap((b) => (b.pocketed ? [-1, -1] : [round(b.x), round(b.y)])))
  snapshot()

  for (let step = 0; step < MAX_STEPS; step++) {
    let moving = false
    for (const b of bodies) {
      if (b.pocketed) continue
      const speed = Math.hypot(b.vx, b.vy)
      if (speed < STOP_SPEED) {
        b.vx = 0
        b.vy = 0
        continue
      }
      moving = true
      const decel = Math.max(0, speed - (ROLLING_DECEL * DT + speed * FRICTION * DT)) / speed
      b.vx *= decel
      b.vy *= decel
      b.x += b.vx * DT
      b.y += b.vy * DT
      // Cushions
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * WALL_RESTITUTION }
      if (b.x > BOARD - b.r) { b.x = BOARD - b.r; b.vx = -Math.abs(b.vx) * WALL_RESTITUTION }
      if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * WALL_RESTITUTION }
      if (b.y > BOARD - b.r) { b.y = BOARD - b.r; b.vy = -Math.abs(b.vy) * WALL_RESTITUTION }
      // Pockets
      if (POCKETS.some(([px, py]) => Math.hypot(b.x - px, b.y - py) < POCKET_R)) {
        b.pocketed = true
        b.vx = b.vy = 0
      }
    }
    // Pairwise elastic collisions with positional correction
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]
      if (a.pocketed) continue
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]
        if (b.pocketed) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.hypot(dx, dy)
        const minDist = a.r + b.r
        if (dist === 0 || dist >= minDist) continue
        const nx = dx / dist
        const ny = dy / dist
        const overlap = minDist - dist
        const total = a.m + b.m
        a.x -= nx * overlap * (b.m / total)
        a.y -= ny * overlap * (b.m / total)
        b.x += nx * overlap * (a.m / total)
        b.y += ny * overlap * (a.m / total)
        const relVel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
        if (relVel > 0) continue
        const impulse = (-(1 + BALL_RESTITUTION) * relVel) / (1 / a.m + 1 / b.m)
        a.vx -= (impulse / a.m) * nx
        a.vy -= (impulse / a.m) * ny
        b.vx += (impulse / b.m) * nx
        b.vy += (impulse / b.m) * ny
        moving = true
      }
    }
    if (step % FRAME_EVERY === 0) snapshot()
    if (!moving) break
  }
  snapshot()
  return { bodies, frames }
}

/** Finds a free spot near the centre for a returned coin. */
function placeNearCentre(coins: Coin[], coin: Coin) {
  for (let ring = 0; ring < 12; ring++) {
    for (let k = 0; k < Math.max(1, ring * 6); k++) {
      const a = (k / Math.max(1, ring * 6)) * Math.PI * 2
      const x = 50 + Math.cos(a) * ring * COIN_R * 2.1
      const y = 50 + Math.sin(a) * ring * COIN_R * 2.1
      if (coins.every((c) => c === coin || c.pocketed || Math.hypot(c.x - x, c.y - y) > COIN_R * 2.05)) {
        coin.x = round(x)
        coin.y = round(y)
        coin.pocketed = false
        return
      }
    }
  }
}

export const carromEngine: GameEngine<CarromState, Move> = {
  meta: {
    key: 'carrom',
    name: 'Carrom',
    minPlayers: 2,
    maxPlayers: 2,
    estMinutes: 15,
    tagline: 'Flick, bank and pocket — physics-driven Carrom.',
    rules: [
      'Player 1 plays White from the bottom baseline; Player 2 plays Black from the top.',
      'Place the striker on your baseline, aim forward and set power. The server simulates every shot.',
      'Pocketing your own coin scores 1 point and gives you another shot.',
      'Pocketing an opponent coin scores for them and ends your turn.',
      'The red Queen is worth 3 points but must be covered by pocketing one of your coins in the same or next shot, otherwise it returns to the centre.',
      'Pocketing the striker is a foul: you lose 1 point and one of your pocketed coins returns to the board.',
      `The game ends when one colour is cleared or after ${MAX_SHOTS} shots. Highest score wins.`,
    ],
    prizeStructure: 'Winner takes the full prize pool. Equal scores split the pool.',
  },
  moveSchema,

  createGame(players) {
    return {
      players,
      forfeited: [],
      moveCount: 0,
      events: [],
      coins: initialCoins(),
      scores: [0, 0],
      turnSeat: 0,
      shots: 0,
      queenPendingSeat: null,
      winnerSeat: null,
      draw: false,
      lastShot: null,
    }
  },
  joinGame: rejectJoin,

  validateMove(state, seat, raw) {
    const parsed = moveSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'Invalid shot parameters.', suspicious: true }
    if (this.getWinner(state).finished) return { ok: false, reason: 'Game is over.' }
    if (seat !== state.turnSeat) return { ok: false, reason: 'Not your turn.' }
    const { angle, position } = parsed.data
    // Shots must travel forward, away from your own baseline.
    const dy = Math.sin(angle)
    if ((seat === 0 && dy > -0.05) || (seat === 1 && dy < 0.05)) return { ok: false, reason: 'You must aim forward, away from your baseline.', suspicious: true }
    const x = strikerX(position)
    const y = BASELINE_Y[seat]
    if (state.coins.some((c) => !c.pocketed && Math.hypot(c.x - x, c.y - y) < COIN_R + STRIKER_R)) {
      return { ok: false, reason: 'The striker overlaps a coin — move it along the baseline.' }
    }
    return { ok: true, move: parsed.data }
  },

  applyMove(prev, seat, move) {
    const s = clone(prev)
    s.moveCount++
    s.shots++
    const x = strikerX(move.position)
    const y = BASELINE_Y[seat]
    const speed = move.power * MAX_SPEED
    const { bodies, frames } = simulate({ x, y, vx: Math.cos(move.angle) * speed, vy: Math.sin(move.angle) * speed }, s.coins)

    const newlyPocketed: number[] = []
    s.coins.forEach((c, i) => {
      const b = bodies[i + 1]
      if (!c.pocketed && b.pocketed) newlyPocketed.push(c.id)
      c.pocketed = b.pocketed
      c.x = round(b.x)
      c.y = round(b.y)
    })
    const strikerPocketed = bodies[0].pocketed
    const opp = 1 - seat
    const mine = ownKind(seat)
    const pocketedCoins = newlyPocketed.map((id) => s.coins[id])
    const ownCount = pocketedCoins.filter((c) => c.kind === mine).length
    const oppCount = pocketedCoins.filter((c) => c.kind === ownKind(opp)).length
    const queenNow = pocketedCoins.some((c) => c.kind === 'queen')
    const events: GameEvent[] = []
    const notes: string[] = []

    s.scores[seat] += ownCount
    s.scores[opp] += oppCount
    if (ownCount) notes.push(`pocketed ${ownCount} own coin${ownCount > 1 ? 's' : ''}`)
    if (oppCount) notes.push(`pocketed ${oppCount} opponent coin${oppCount > 1 ? 's' : ''}`)
    newlyPocketed.forEach((id) => events.push({ type: 'pocket', seat, coin: id, kind: s.coins[id].kind }))

    const queen = s.coins.find((c) => c.kind === 'queen')!
    if (queenNow) {
      if (ownCount > 0 && !strikerPocketed) {
        s.scores[seat] += 3
        notes.push('pocketed and covered the Queen (+3)')
        events.push({ type: 'queen-covered', seat })
      } else {
        s.queenPendingSeat = seat
        notes.push('pocketed the Queen — cover it next shot')
      }
    } else if (s.queenPendingSeat === seat) {
      if (ownCount > 0 && !strikerPocketed) {
        s.scores[seat] += 3
        notes.push('covered the Queen (+3)')
        events.push({ type: 'queen-covered', seat })
      } else {
        placeNearCentre(s.coins, queen)
        notes.push('failed to cover the Queen — it returns to the centre')
        events.push({ type: 'queen-returned', seat })
      }
      s.queenPendingSeat = null
    }

    if (strikerPocketed) {
      events.push({ type: 'foul', seat })
      notes.push('FOUL: striker pocketed (−1)')
      if (s.scores[seat] > 0) {
        s.scores[seat] -= 1
        const back = s.coins.find((c) => c.pocketed && c.kind === mine)
        if (back) placeNearCentre(s.coins, back)
      }
      if (s.queenPendingSeat === seat) {
        placeNearCentre(s.coins, queen)
        s.queenPendingSeat = null
      }
    }

    const continues = !strikerPocketed && (ownCount > 0 || queenNow)
    if (!continues) s.turnSeat = opp

    // End conditions
    const remaining = (kind: CoinKind) => s.coins.filter((c) => c.kind === kind && !c.pocketed).length
    if (remaining('white') === 0 || remaining('black') === 0 || s.shots >= MAX_SHOTS) {
      if (s.scores[0] === s.scores[1]) s.draw = true
      else s.winnerSeat = s.scores[0] > s.scores[1] ? 0 : 1
      events.push({ type: 'game-over' })
    }

    s.lastShot = {
      seat,
      striker: { x: round(x), y, angle: move.angle, power: move.power },
      pocketed: newlyPocketed,
      strikerPocketed,
      frames,
      summary: notes.length ? notes.join(', ') : 'no coins pocketed',
    }
    s.events = events
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
    s.events = [{ type: 'forfeit', seat }]
    return s
  },

  /** Aims at a random own coin in front of the baseline (or straight ahead) with medium power. */
  autoMove(s, seat, rng: Rng) {
    const y = BASELINE_Y[seat]
    const forward = (cy: number) => (seat === 0 ? cy < y - 4 : cy > y + 4)
    const targets = s.coins.filter((c) => !c.pocketed && forward(c.y))
    const preferred = targets.filter((c) => c.kind === ownKind(seat) || c.kind === 'queen')
    const pool = preferred.length ? preferred : targets
    for (let attempt = 0; attempt < 20; attempt++) {
      const position = rng.float()
      const x = strikerX(position)
      if (s.coins.some((c) => !c.pocketed && Math.hypot(c.x - x, c.y - y) < COIN_R + STRIKER_R + 0.2)) continue
      const target = pool.length ? pool[rng.int(0, pool.length)] : { x: 50, y: 50 }
      let angle = Math.atan2(target.y - y, target.x - x) + (rng.float() - 0.5) * 0.08
      const dy = Math.sin(angle)
      if ((seat === 0 && dy > -0.1) || (seat === 1 && dy < 0.1)) angle = seat === 0 ? -Math.PI / 2 : Math.PI / 2
      return { type: 'shot', position: round(position), angle, power: round(0.55 + rng.float() * 0.3) }
    }
    return { type: 'shot', position: 0.5, angle: seat === 0 ? -Math.PI / 2 : Math.PI / 2, power: 0.6 }
  },
}
