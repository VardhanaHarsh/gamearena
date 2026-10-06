import { motion } from 'motion/react'
import { useState } from 'react'
import { Dice } from './Dice'
import type { BoardProps } from '../types'

type Color = 'red' | 'green' | 'yellow' | 'blue'
interface LudoState {
  colors: Color[]
  tokens: number[][]
  turnSeat: number
  phase: 'ROLL' | 'MOVE'
  dice: number | null
  legalTokens: number[]
  forfeited: number[]
  lastAction: { seat: number; kind: string; dice?: number } | null
}

// Geometry mirrors the server engine: 52 shared squares, START offsets, 5 home-column squares, then home.
const START: Record<Color, number> = { red: 0, green: 13, yellow: 26, blue: 39 }
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47])
const FILL: Record<Color, string> = { red: '#ef4444', green: '#22c55e', yellow: '#eab308', blue: '#3b82f6' }

/** TRACK[i] = [col, row] of shared square i on a 15×15 grid (clockwise from red's start). */
const TRACK: [number, number][] = (() => {
  const t: [number, number][] = []
  for (let x = 1; x <= 5; x++) t.push([x, 6])
  for (let y = 5; y >= 0; y--) t.push([6, y])
  t.push([7, 0])
  for (let y = 0; y <= 5; y++) t.push([8, y])
  for (let x = 9; x <= 14; x++) t.push([x, 6])
  t.push([14, 7])
  for (let x = 14; x >= 9; x--) t.push([x, 8])
  for (let y = 9; y <= 14; y++) t.push([8, y])
  t.push([7, 14])
  for (let y = 14; y >= 9; y--) t.push([6, y])
  for (let x = 5; x >= 0; x--) t.push([x, 8])
  t.push([0, 7])
  t.push([0, 6])
  return t
})()

const HOME_COLUMN: Record<Color, (i: number) => [number, number]> = {
  red: (i) => [1 + i, 7],
  green: (i) => [7, 1 + i],
  yellow: (i) => [13 - i, 7],
  blue: (i) => [7, 13 - i],
}
const YARD_ORIGIN: Record<Color, [number, number]> = { red: [0, 0], green: [9, 0], yellow: [9, 9], blue: [0, 9] }
const HOME_SPOT: Record<Color, [number, number]> = { red: [6.4, 7.5], green: [7.5, 6.4], yellow: [8.6, 7.5], blue: [7.5, 8.6] }

function tokenPosition(color: Color, progress: number, index: number): [number, number] {
  if (progress < 0) {
    const [ox, oy] = YARD_ORIGIN[color]
    return [ox + 1.75 + (index % 2) * 2.5, oy + 1.75 + Math.floor(index / 2) * 2.5]
  }
  if (progress >= 56) {
    const [hx, hy] = HOME_SPOT[color]
    return [hx + (index % 2) * 0.35 - 0.17, hy + Math.floor(index / 2) * 0.35 - 0.17]
  }
  if (progress > 50) {
    const [x, y] = HOME_COLUMN[color](progress - 51)
    return [x + 0.5, y + 0.5]
  }
  const [x, y] = TRACK[(START[color] + progress) % 52]
  return [x + 0.5, y + 0.5]
}

export function LudoBoard({ view, seats, mySeat, isMyTurn, sendMove }: BoardProps<LudoState>) {
  const s = view.state
  const [busy, setBusy] = useState(false)
  const myColor = mySeat !== null ? s.colors[mySeat] : null
  const canRoll = isMyTurn && s.phase === 'ROLL' && !busy
  const canMove = isMyTurn && s.phase === 'MOVE' && !busy

  const act = (move: unknown) => {
    setBusy(true)
    sendMove(move).catch(() => {}).finally(() => setBusy(false))
  }

  // Stack offsets for tokens sharing a square.
  const placed = new Map<string, number>()
  const tokens = s.tokens.flatMap((list, seat) =>
    list.map((progress, index) => {
      const color = s.colors[seat]
      const [x, y] = tokenPosition(color, progress, index)
      const key = `${x.toFixed(2)},${y.toFixed(2)}`
      const n = placed.get(key) ?? 0
      placed.set(key, n + 1)
      const off = progress >= 0 && progress <= 55 ? n * 0.16 : 0
      return { seat, index, color, progress, x: x + off, y: y - off }
    }),
  )

  return (
    <div className="mx-auto flex w-full max-w-[min(94vw,620px,calc(100dvh-270px))] min-w-[280px] flex-col items-center gap-3 sm:gap-4">
      <div className="relative w-full rounded-3xl border border-line-2 bg-[#f8f5ec] p-1.5 shadow-2xl dark:bg-[#1a1830]">
        <svg viewBox="0 0 15 15" className="block w-full touch-manipulation select-none" role="img" aria-label="Ludo board">
          {/* yards */}
          {(Object.keys(YARD_ORIGIN) as Color[]).map((c) => {
            const [ox, oy] = YARD_ORIGIN[c]
            return (
              <g key={c}>
                <rect x={ox} y={oy} width={6} height={6} rx={0.4} fill={FILL[c]} opacity={s.colors.includes(c) ? 0.9 : 0.25} />
                <rect x={ox + 0.8} y={oy + 0.8} width={4.4} height={4.4} rx={0.4} fill="#fff" opacity={0.92} />
                {[0, 1, 2, 3].map((i) => (
                  <circle key={i} cx={ox + 1.75 + (i % 2) * 2.5} cy={oy + 1.75 + Math.floor(i / 2) * 2.5} r={0.55} fill={FILL[c]} opacity={0.25} />
                ))}
              </g>
            )
          })}
          {/* shared track */}
          {TRACK.map(([x, y], i) => {
            const startColor = (Object.keys(START) as Color[]).find((c) => START[c] === i)
            return (
              <g key={i}>
                <rect x={x + 0.04} y={y + 0.04} width={0.92} height={0.92} rx={0.12} fill={startColor ? FILL[startColor] : '#ffffff'} opacity={startColor ? 0.85 : 1} stroke="#d4d0c4" strokeWidth={0.03} />
                {SAFE.has(i) && !startColor && <text x={x + 0.5} y={y + 0.72} fontSize={0.62} textAnchor="middle" fill="#a8a29e">★</text>}
              </g>
            )
          })}
          {/* home columns */}
          {(Object.keys(HOME_COLUMN) as Color[]).map((c) =>
            [0, 1, 2, 3, 4].map((i) => {
              const [x, y] = HOME_COLUMN[c](i)
              return <rect key={`${c}${i}`} x={x + 0.04} y={y + 0.04} width={0.92} height={0.92} rx={0.12} fill={FILL[c]} opacity={0.75} />
            }),
          )}
          {/* center home triangles */}
          <polygon points="6,6 7.5,7.5 6,9" fill={FILL.red} />
          <polygon points="6,6 7.5,7.5 9,6" fill={FILL.green} />
          <polygon points="9,6 7.5,7.5 9,9" fill={FILL.yellow} />
          <polygon points="6,9 7.5,7.5 9,9" fill={FILL.blue} />

          {/* tokens */}
          {tokens.map((t) => {
            const movable = canMove && t.seat === mySeat && s.legalTokens.includes(t.index)
            return (
              <motion.g
                key={`${t.seat}-${t.index}`}
                initial={false}
                animate={{ x: t.x, y: t.y }}
                transition={{ type: 'spring', stiffness: 220, damping: 22 }}
                style={{ cursor: movable ? 'pointer' : 'default' }}
                onClick={() => movable && act({ type: 'move', token: t.index })}
                role={movable ? 'button' : undefined}
                aria-label={movable ? `Move ${t.color} token ${t.index + 1}` : undefined}
                tabIndex={movable ? 0 : -1}
                onKeyDown={(e) => movable && (e.key === 'Enter' || e.key === ' ') && act({ type: 'move', token: t.index })}
              >
                {movable && (
                  <motion.circle r={0.55} fill="none" stroke="#fff" strokeWidth={0.08} animate={{ r: [0.45, 0.62, 0.45], opacity: [1, 0.4, 1] }} transition={{ repeat: Infinity, duration: 1.1 }} />
                )}
                <circle r={0.36} fill={FILL[t.color]} stroke="#fff" strokeWidth={0.09} opacity={s.forfeited.includes(t.seat) ? 0.3 : 1} />
                <circle r={0.13} fill="#fff" opacity={0.6} />
              </motion.g>
            )
          })}
        </svg>
      </div>

      <div className="flex w-full items-center justify-center gap-3 sm:gap-4">
        <Dice value={s.dice ?? s.lastAction?.dice ?? null} rolling={busy && s.phase === 'ROLL'} disabled={!canRoll} color={myColor ? FILL[myColor] : '#8b5cf6'} onRoll={() => act({ type: 'roll' })} />
        <p className="flex-1 text-sm text-muted sm:flex-none sm:min-w-48" aria-live="polite">
          {isMyTurn
            ? s.phase === 'ROLL'
              ? 'Your turn — roll the dice!'
              : `You rolled ${s.dice}. Tap a glowing token.`
            : `Waiting for ${seats[s.turnSeat]?.displayName ?? 'opponent'}…`}
        </p>
      </div>
    </div>
  )
}
