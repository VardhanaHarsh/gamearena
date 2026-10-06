import { Box, Square } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { play } from '../../services/sound'
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
  events: { type: string; seat?: number; value?: number; token?: number; from?: number; to?: number; captured?: { seat: number; token: number }[] }[]
  lastAction: { seat: number; kind: 'roll' | 'move' | 'pass'; dice?: number; token?: number; from?: number; to?: number; captured?: { seat: number; token: number }[] } | null
}

// Geometry mirrors the server engine: 52 shared squares, START offsets, 5 home-column squares, then home (56).
const START: Record<Color, number> = { red: 0, green: 13, yellow: 26, blue: 39 }
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47])
const FILL: Record<Color, string> = { red: '#ef4444', green: '#22c55e', yellow: '#eab308', blue: '#3b82f6' }
const DARK: Record<Color, string> = { red: '#991b1b', green: '#166534', yellow: '#a16207', blue: '#1e40af' }
const LIGHT: Record<Color, string> = { red: '#fecaca', green: '#bbf7d0', yellow: '#fef08a', blue: '#bfdbfe' }
/** Must match LUDO_ANIM on the server (it waits for these animations before the next turn). */
const HOP_MS = 170
const TILT = 34 // degrees, 3D view

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
const HOME_SPOT: Record<Color, [number, number]> = { red: [6.45, 7.5], green: [7.5, 6.45], yellow: [8.55, 7.5], blue: [7.5, 8.55] }

/** Centre of the square a token with this progress stands on (board units, 0..15). */
function tokenPosition(color: Color, progress: number, index: number): [number, number] {
  if (progress < 0) {
    const [ox, oy] = YARD_ORIGIN[color]
    return [ox + 1.75 + (index % 2) * 2.5, oy + 1.75 + Math.floor(index / 2) * 2.5]
  }
  if (progress >= 56) {
    const [hx, hy] = HOME_SPOT[color]
    return [hx + (index % 2) * 0.4 - 0.2, hy + Math.floor(index / 2) * 0.4 - 0.2]
  }
  if (progress > 50) {
    const [x, y] = HOME_COLUMN[color](progress - 51)
    return [x + 0.5, y + 0.5]
  }
  const [x, y] = TRACK[(START[color] + progress) % 52]
  return [x + 0.5, y + 0.5]
}

/** Squares visited moving from `from` to `to` (inclusive of the destination). */
const pathOf = (color: Color, from: number, to: number, index: number) =>
  from < 0 ? [tokenPosition(color, 0, index)] : Array.from({ length: to - from }, (_, i) => tokenPosition(color, from + i + 1, index))

const pct = (v: number) => `${(v / 15) * 100}%`

function useStoredToggle(key: string, initial: boolean) {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(key)
      return s === null ? initial : s === '1'
    } catch {
      return initial
    }
  })
  const set = (next: boolean) => {
    setV(next)
    try {
      localStorage.setItem(key, next ? '1' : '0')
    } catch {
      /* ignore */
    }
  }
  return [v, set] as const
}

export function LudoBoard({ view, seats, mySeat, isMyTurn, sendMove }: BoardProps<LudoState>) {
  const s = view.state
  const [busy, setBusy] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const [is3d, set3d] = useStoredToggle('ga-ludo-3d', true)
  const myColor = mySeat !== null ? s.colors[mySeat] : null
  const canRoll = isMyTurn && s.phase === 'ROLL' && !busy
  const canMove = isMyTurn && s.phase === 'MOVE' && !busy
  const turnColor = s.colors[s.turnSeat]

  const act = (move: unknown) => {
    setBusy(true)
    sendMove(move).catch(() => {}).finally(() => setBusy(false))
  }

  // Remember where every token was, so a change can be animated square by square.
  const prev = useRef<number[][] | null>(null)
  const anim = useMemo(() => {
    const before = prev.current
    prev.current = s.tokens.map((t) => [...t])
    const a = s.lastAction
    const plan = new Map<string, { xs: number[]; ys: number[]; duration: number; delay: number; hop: boolean }>()
    if (!before || !a || a.kind !== 'move' || a.token === undefined || a.from === undefined || a.to === undefined) return plan
    const color = s.colors[a.seat]
    const startPos = tokenPosition(color, a.from, a.token)
    const path = [startPos, ...pathOf(color, a.from, a.to, a.token)]
    plan.set(`${a.seat}-${a.token}`, { xs: path.map((p) => p[0]), ys: path.map((p) => p[1]), duration: ((path.length - 1) * HOP_MS) / 1000, delay: 0, hop: true })
    for (const c of a.captured ?? []) {
      const cc = s.colors[c.seat]
      const fromPos = tokenPosition(cc, before[c.seat]?.[c.token] ?? 0, c.token)
      const home = tokenPosition(cc, -1, c.token)
      plan.set(`${c.seat}-${c.token}`, { xs: [fromPos[0], home[0]], ys: [fromPos[1], home[1]], duration: 0.6, delay: ((path.length - 1) * HOP_MS) / 1000, hop: false })
    }
    return plan
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.seq])

  // Sounds for hops and captures, synced to the animation.
  useEffect(() => {
    const a = s.lastAction
    if (!a || a.kind !== 'move' || a.from === undefined || a.to === undefined) return
    const steps = a.from < 0 ? 1 : a.to - a.from
    const timers = Array.from({ length: steps }, (_, i) => setTimeout(() => play('click'), i * HOP_MS))
    if (a.captured?.length) timers.push(setTimeout(() => play('capture'), steps * HOP_MS))
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.seq])

  // Floating message for the latest event.
  const banner = useMemo(() => {
    const ev = s.events ?? []
    const who = (seat?: number) => (seat === mySeat ? 'You' : seats[seat ?? 0]?.displayName ?? 'Player')
    if (ev.some((e) => e.type === 'win')) return null
    if (ev.some((e) => e.type === 'capture')) return { text: `${who(ev[0]?.seat)} captured!`, tone: 'bg-red-500' }
    if (ev.some((e) => e.type === 'home')) return { text: 'Token home! 🏁', tone: 'bg-emerald-500' }
    if (ev.some((e) => e.type === 'three-sixes')) return { text: 'Three sixes — turn lost', tone: 'bg-slate-600' }
    const dice = ev.find((e) => e.type === 'dice')
    if (dice?.value === 6 && s.phase === 'MOVE') return { text: 'Six! Move, then roll again', tone: 'bg-amber-500' }
    if (ev.some((e) => e.type === 'no-move')) return { text: `${who(dice?.seat)} rolled ${dice?.value} — no move`, tone: 'bg-slate-600' }
    return null
  }, [s.events, s.phase, mySeat, seats])

  // Capture burst position.
  const burst = useMemo(() => {
    const a = s.lastAction
    if (!a?.captured?.length || a.to === undefined || a.token === undefined) return null
    const [x, y] = tokenPosition(s.colors[a.seat], a.to, a.token)
    return { x, y, delay: ((a.from !== undefined && a.from >= 0 ? a.to - a.from : 1) * HOP_MS) / 1000 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.seq])

  // Destination preview for the hovered movable token.
  const preview = useMemo(() => {
    if (hover === null || mySeat === null || !s.dice || !canMove || !s.legalTokens.includes(hover)) return null
    const color = s.colors[mySeat]
    const from = s.tokens[mySeat][hover]
    const to = from < 0 ? 0 : from + s.dice
    return { path: pathOf(color, from, to, hover), color }
  }, [hover, mySeat, s, canMove])

  // Tokens, with small offsets when several share a square.
  const placed = new Map<string, number>()
  const tokens = s.tokens.flatMap((list, seat) =>
    list.map((progress, index) => {
      const color = s.colors[seat]
      const [x, y] = tokenPosition(color, progress, index)
      const key = `${x.toFixed(2)},${y.toFixed(2)}`
      const n = placed.get(key) ?? 0
      placed.set(key, n + 1)
      const off = progress >= 0 && progress <= 55 ? n * 0.2 : 0
      return { seat, index, color, progress, x: x + off, y: y - off, movable: canMove && seat === mySeat && s.legalTokens.includes(index) }
    }),
  )
  // Draw back-to-front so nearer pawns overlap farther ones in 3D.
  tokens.sort((a, b) => a.y - b.y)

  return (
    <div className="mx-auto flex w-full max-w-[min(94vw,620px,calc(100dvh-330px))] min-w-[240px] flex-col items-center gap-3 sm:gap-4 land:max-w-full land:flex-row land:justify-center land:gap-6">
      <div className="relative w-full shrink-0 land:w-[min(640px,calc(100dvh-215px))] short:w-[calc(100dvh-140px)]" style={{ perspective: '1300px' }}>
        <motion.div
          className="relative rounded-3xl border-[6px] border-[#3b2a63] bg-[#f8f5ec] p-1.5 shadow-[0_30px_60px_-20px_rgba(0,0,0,.7),inset_0_0_0_2px_rgba(255,255,255,.08)] dark:bg-[#1a1830]"
          animate={{ rotateX: is3d ? TILT : 0, scale: is3d ? 0.96 : 1, y: is3d ? '-2%' : '0%' }}
          transition={{ type: 'spring', stiffness: 120, damping: 18 }}
          style={{ transformStyle: 'preserve-3d', transformOrigin: '50% 60%' }}
        >
          <div className="relative" style={{ transformStyle: 'preserve-3d' }}>
            <svg viewBox="0 0 15 15" className="block w-full touch-manipulation select-none" role="img" aria-label="Ludo board">
              <defs>
                {(Object.keys(FILL) as Color[]).map((c) => (
                  <linearGradient key={c} id={`yard-${c}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor={FILL[c]} />
                    <stop offset="1" stopColor={DARK[c]} />
                  </linearGradient>
                ))}
              </defs>
              {/* yards */}
              {(Object.keys(YARD_ORIGIN) as Color[]).map((c) => {
                const [ox, oy] = YARD_ORIGIN[c]
                const active = c === turnColor && s.colors.includes(c)
                return (
                  <g key={c}>
                    <rect x={ox + 0.05} y={oy + 0.05} width={5.9} height={5.9} rx={0.45} fill={`url(#yard-${c})`} opacity={s.colors.includes(c) ? 1 : 0.25} />
                    {active && (
                      <motion.rect x={ox + 0.05} y={oy + 0.05} width={5.9} height={5.9} rx={0.45} fill="none" stroke="#fff" strokeWidth={0.12} animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1.4 }} />
                    )}
                    <rect x={ox + 0.8} y={oy + 0.8} width={4.4} height={4.4} rx={0.5} fill="#fff" opacity={0.94} />
                    {[0, 1, 2, 3].map((i) => (
                      <circle key={i} cx={ox + 1.75 + (i % 2) * 2.5} cy={oy + 1.75 + Math.floor(i / 2) * 2.5} r={0.62} fill={LIGHT[c]} stroke={FILL[c]} strokeWidth={0.08} />
                    ))}
                  </g>
                )
              })}
              {/* shared track */}
              {TRACK.map(([x, y], i) => {
                const startColor = (Object.keys(START) as Color[]).find((c) => START[c] === i)
                return (
                  <g key={i}>
                    <rect x={x + 0.05} y={y + 0.05} width={0.9} height={0.9} rx={0.14} fill={startColor ? FILL[startColor] : '#ffffff'} stroke="#d4d0c4" strokeWidth={0.03} />
                    {SAFE.has(i) && !startColor && <text x={x + 0.5} y={y + 0.73} fontSize={0.66} textAnchor="middle" fill="#a8a29e">★</text>}
                    {startColor && <path d={`M${x + 0.3} ${y + 0.5} h0.4 M${x + 0.55} ${y + 0.32} l0.18 0.18 -0.18 0.18`} stroke="#fff" strokeWidth={0.08} fill="none" strokeLinecap="round" />}
                  </g>
                )
              })}
              {/* home columns */}
              {(Object.keys(HOME_COLUMN) as Color[]).map((c) =>
                [0, 1, 2, 3, 4].map((i) => {
                  const [x, y] = HOME_COLUMN[c](i)
                  return <rect key={`${c}${i}`} x={x + 0.05} y={y + 0.05} width={0.9} height={0.9} rx={0.14} fill={FILL[c]} opacity={0.82} />
                }),
              )}
              {/* centre home */}
              <polygon points="6,6 7.5,7.5 6,9" fill={FILL.red} />
              <polygon points="6,6 7.5,7.5 9,6" fill={FILL.green} />
              <polygon points="9,6 7.5,7.5 9,9" fill={FILL.yellow} />
              <polygon points="6,9 7.5,7.5 9,9" fill={FILL.blue} />
              <circle cx="7.5" cy="7.5" r="0.55" fill="#fff" opacity=".9" />
              <text x="7.5" y="7.72" fontSize="0.6" textAnchor="middle">🏆</text>

              {/* path preview for the hovered token */}
              {preview?.path.map(([x, y], i) => (
                <motion.rect
                  key={`pv${i}`}
                  x={x - 0.45}
                  y={y - 0.45}
                  width={0.9}
                  height={0.9}
                  rx={0.14}
                  fill={FILL[preview.color]}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: i === preview.path.length - 1 ? 0.75 : 0.3 }}
                  transition={{ delay: i * 0.04 }}
                />
              ))}
              {preview && (
                <motion.circle cx={preview.path[preview.path.length - 1][0]} cy={preview.path[preview.path.length - 1][1]} r={0.5} fill="none" stroke="#fff" strokeWidth={0.1} animate={{ r: [0.35, 0.6, 0.35] }} transition={{ repeat: Infinity, duration: 0.9 }} />
              )}

              {/* token shadows + movable rings on the board plane */}
              {tokens.map((t) => (
                <motion.g key={`sh${t.seat}-${t.index}`} initial={false} animate={{ x: anim.get(`${t.seat}-${t.index}`)?.xs ?? t.x, y: anim.get(`${t.seat}-${t.index}`)?.ys ?? t.y }} transition={transitionFor(anim.get(`${t.seat}-${t.index}`))}>
                  <ellipse rx={0.34} ry={0.2} cy={0.12} fill="#000" opacity={s.forfeited.includes(t.seat) ? 0.1 : 0.32} />
                  {t.movable && <motion.circle r={0.5} fill="none" stroke={FILL[t.color]} strokeWidth={0.1} animate={{ r: [0.38, 0.62, 0.38], opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1 }} />}
                </motion.g>
              ))}

              {/* capture burst */}
              <AnimatePresence>
                {burst && (
                  <motion.g key={`burst${view.seq}`} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ delay: burst.delay, duration: 0.8 }}>
                    {Array.from({ length: 10 }, (_, i) => {
                      const a = (i / 10) * Math.PI * 2
                      return (
                        <motion.circle key={i} cx={burst.x} cy={burst.y} r={0.12} fill={i % 2 ? '#fde047' : '#f97316'} initial={{ cx: burst.x, cy: burst.y }} animate={{ cx: burst.x + Math.cos(a) * 1.3, cy: burst.y + Math.sin(a) * 1.3 }} transition={{ delay: burst.delay, duration: 0.7, ease: 'easeOut' }} />
                      )
                    })}
                  </motion.g>
                )}
              </AnimatePresence>
            </svg>

            {/* upright 3D pawns (HTML so they can counter-rotate and stand up when the board tilts) */}
            <div className="pointer-events-none absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
              {tokens.map((t) => {
                const plan = anim.get(`${t.seat}-${t.index}`)
                return (
                  <motion.button
                    key={`${t.seat}-${t.index}`}
                    type="button"
                    tabIndex={t.movable ? 0 : -1}
                    aria-label={t.movable ? `Move ${t.color} token ${t.index + 1}` : `${t.color} token ${t.index + 1}`}
                    disabled={!t.movable}
                    onClick={() => t.movable && act({ type: 'move', token: t.index })}
                    onMouseEnter={() => t.movable && setHover(t.index)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => t.movable && setHover(t.index)}
                    onBlur={() => setHover(null)}
                    initial={false}
                    animate={{ left: plan ? plan.xs.map(pct) : pct(t.x), top: plan ? plan.ys.map(pct) : pct(t.y) }}
                    transition={transitionFor(plan)}
                    className={`pointer-events-auto absolute h-[8.2%] w-[5.4%] -translate-x-1/2 -translate-y-[88%] ${t.movable ? 'cursor-pointer' : 'cursor-default'}`}
                    style={{ transformStyle: 'preserve-3d', zIndex: Math.round(t.y * 10) }}
                  >
                    <motion.span
                      className="block size-full origin-bottom"
                      animate={{
                        rotateX: is3d ? -TILT : 0,
                        y: plan?.hop ? plan.xs.flatMap((_, i) => (i === 0 ? ['0%'] : ['-55%', '0%'])) : t.movable ? ['0%', '-18%', '0%'] : '0%',
                        scale: t.movable && hover === t.index ? 1.18 : 1,
                      }}
                      transition={
                        plan?.hop
                          ? { y: { duration: plan.duration, ease: 'easeInOut' }, rotateX: { type: 'spring', stiffness: 120, damping: 18 } }
                          : { y: t.movable ? { repeat: Infinity, duration: 0.9 } : { duration: 0.2 }, rotateX: { type: 'spring', stiffness: 120, damping: 18 } }
                      }
                    >
                      <Pawn color={t.color} dim={s.forfeited.includes(t.seat)} highlight={t.movable} />
                    </motion.span>
                  </motion.button>
                )
              })}
            </div>
          </div>
        </motion.div>

        {/* event banner */}
        <AnimatePresence>
          {banner && (
            <motion.div
              key={view.seq}
              initial={{ opacity: 0, y: 12, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className={`pointer-events-none absolute top-[42%] left-1/2 z-[500] -translate-x-1/2 rounded-full px-4 py-1.5 text-sm font-bold whitespace-nowrap text-white shadow-xl ${banner.tone}`}
            >
              {banner.text}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={() => set3d(!is3d)}
          className="absolute top-2 right-2 z-[600] inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur transition hover:bg-black/75"
          aria-pressed={is3d}
        >
          {is3d ? <Square className="size-3" /> : <Box className="size-3" />}
          {is3d ? '2D view' : '3D view'}
        </button>
      </div>

      <div className="flex w-full items-center justify-center gap-3 sm:gap-4 land:w-48 land:flex-col land:items-start">
        <Dice value={s.dice ?? s.lastAction?.dice ?? null} rollKey={s.lastAction?.kind !== 'move' ? view.seq : -1} waiting={busy && s.phase === 'ROLL'} disabled={!canRoll} color={myColor ? FILL[myColor] : '#8b5cf6'} onRoll={() => act({ type: 'roll' })} />
        <div className="flex-1 sm:flex-none sm:min-w-48" aria-live="polite">
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: FILL[turnColor] }}>
            <span className="inline-block size-2.5 rounded-full" style={{ background: FILL[turnColor] }} />
            {s.turnSeat === mySeat ? 'Your turn' : `${seats[s.turnSeat]?.displayName ?? 'Opponent'}'s turn`}
          </p>
          <p className="text-sm text-muted">
            {isMyTurn ? (s.phase === 'ROLL' ? 'Tap the dice to roll' : `You rolled ${s.dice} — tap a bouncing token`) : 'Watch their move…'}
          </p>
        </div>
      </div>
    </div>
  )
}

function transitionFor(plan: { duration: number; delay: number; hop: boolean } | undefined) {
  if (!plan) return { type: 'spring' as const, stiffness: 220, damping: 24 }
  return { duration: plan.duration, delay: plan.delay, ease: plan.hop ? ('linear' as const) : ('easeInOut' as const) }
}

/** A glossy 3D pawn (base, body, head) in the player's colour. */
function Pawn({ color, dim, highlight }: { color: Color; dim: boolean; highlight: boolean }) {
  const id = `pawn-${color}`
  return (
    <svg viewBox="0 0 40 60" className="size-full overflow-visible" style={{ opacity: dim ? 0.3 : 1, filter: highlight ? `drop-shadow(0 0 6px ${FILL[color]})` : 'drop-shadow(0 3px 2px rgba(0,0,0,.35))' }} aria-hidden>
      <defs>
        <radialGradient id={id} cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor={LIGHT[color]} />
          <stop offset=".45" stopColor={FILL[color]} />
          <stop offset="1" stopColor={DARK[color]} />
        </radialGradient>
      </defs>
      <ellipse cx="20" cy="54" rx="15" ry="5" fill={DARK[color]} />
      <ellipse cx="20" cy="52" rx="15" ry="5" fill={`url(#${id})`} stroke="#fff" strokeOpacity=".5" strokeWidth="1" />
      <path d="M11 51 C12 40 15 33 17 28 L23 28 C25 33 28 40 29 51 Z" fill={`url(#${id})`} />
      <ellipse cx="20" cy="28" rx="7.5" ry="2.6" fill={DARK[color]} opacity=".6" />
      <circle cx="20" cy="17" r="10" fill={`url(#${id})`} stroke="#fff" strokeOpacity=".55" strokeWidth="1" />
      <ellipse cx="16.5" cy="13" rx="3.4" ry="2.2" fill="#fff" opacity=".7" />
    </svg>
  )
}
