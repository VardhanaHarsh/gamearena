import { Lock, LockOpen, MousePointerClick } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { Button } from '../../components/ui'
import { play } from '../../services/sound'
import type { BoardProps } from '../types'

interface Coin {
  id: number
  kind: 'white' | 'black' | 'queen'
  x: number
  y: number
  pocketed: boolean
}
interface CarromState {
  coins: Coin[]
  scores: [number, number]
  turnSeat: number
  shots: number
  queenPendingSeat: number | null
  lastShot: { seat: number; striker: { x: number; y: number }; frames: number[][]; summary: string; strikerPocketed: boolean } | null
}

// Geometry mirrors the server engine (backend/src/modules/games/engines/carrom.engine.ts).
const COIN_R = 1.7
const STRIKER_R = 2.3
const POCKET_R = 4.2
const BASELINE_Y = [82, 18]
const BASELINE_X = [22, 78]
const POCKETS: [number, number][] = [[3.2, 3.2], [96.8, 3.2], [3.2, 96.8], [96.8, 96.8]]
const FRAME_MS = 1000 / 30
/** Must equal CARROM_PLAYBACK_SPEED on the server, which waits for this replay before the next turn. */
const PLAYBACK_SPEED = 0.5
const FRAME = 6 // wooden frame thickness drawn outside the 0..100 playing area
const VIEW = `${-FRAME} ${-FRAME} ${100 + FRAME * 2} ${100 + FRAME * 2}`

const strikerX = (p: number) => BASELINE_X[0] + p * (BASELINE_X[1] - BASELINE_X[0])
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

type Body = { x: number; y: number; r: number; scale: number; trail: [number, number] | null }

/** Interpolated body positions at a playback time, including a sink-into-pocket animation. */
function sample(frames: number[][], ms: number, count: number): Body[] {
  const f = ms / FRAME_MS
  const i = Math.min(Math.floor(f), frames.length - 1)
  const k = f - i
  const a = frames[i]
  const b = frames[Math.min(i + 1, frames.length - 1)]
  const back = frames[Math.max(0, i - 4)]
  const out: Body[] = []
  for (let n = 0; n < count; n++) {
    const ax = a[n * 2], ay = a[n * 2 + 1], bx = b[n * 2], by = b[n * 2 + 1]
    const r = n === 0 ? STRIKER_R : COIN_R
    if (ax < 0) { out.push({ x: -1, y: -1, r, scale: 0, trail: null }); continue }
    if (bx < 0) {
      // pocketed between these frames: glide to the nearest pocket and shrink
      const [px, py] = POCKETS.reduce((best, p) => (Math.hypot(p[0] - ax, p[1] - ay) < Math.hypot(best[0] - ax, best[1] - ay) ? p : best))
      out.push({ x: ax + (px - ax) * k, y: ay + (py - ay) * k, r, scale: 1 - k * 0.85, trail: null })
      continue
    }
    const x = ax + (bx - ax) * k, y = ay + (by - ay) * k
    const tx = back[n * 2], ty = back[n * 2 + 1]
    out.push({ x, y, r, scale: 1, trail: tx >= 0 && Math.hypot(x - tx, y - ty) > 1.2 ? [tx, ty] : null })
  }
  return out
}

/** Where a ray from (px,py) along unit (dx,dy) first touches a coin (striker radius included). */
function firstHit(px: number, py: number, dx: number, dy: number, coins: Coin[]) {
  let best: { t: number; coin: Coin } | null = null
  const R = COIN_R + STRIKER_R
  for (const c of coins) {
    if (c.pocketed) continue
    const ox = px - c.x, oy = py - c.y
    const b = ox * dx + oy * dy
    const disc = b * b - (ox * ox + oy * oy - R * R)
    if (disc < 0) continue
    const t = -b - Math.sqrt(disc)
    if (t > 0.01 && (!best || t < best.t)) best = { t, coin: c }
  }
  return best
}

/** Distance along a ray until the striker touches a cushion, and the cushion's normal. */
function toWall(px: number, py: number, dx: number, dy: number) {
  const lo = STRIKER_R, hi = 100 - STRIKER_R
  const tx = dx > 0 ? (hi - px) / dx : dx < 0 ? (lo - px) / dx : Infinity
  const ty = dy > 0 ? (hi - py) / dy : dy < 0 ? (lo - py) / dy : Infinity
  return tx < ty ? { t: tx, nx: true } : { t: ty, nx: false }
}

/** A coin drawn with thickness, shadow, face gradient, inlay ring and specular highlight. */
function Disc({ x, y, r, kind, scale = 1, id }: { x: number; y: number; r: number; kind: Coin['kind'] | 'striker'; scale?: number; id: string }) {
  if (scale <= 0) return null
  const rr = r * scale
  const edge = { white: '#b9ab8a', black: '#050404', queen: '#5f1414', striker: '#1e3a8a' }[kind]
  const ring = { white: '#d9cdb0', black: '#5a4d48', queen: '#fecaca', striker: '#bfdbfe' }[kind]
  return (
    <g>
      <ellipse cx={x + rr * 0.28} cy={y + rr * 0.42} rx={rr * 1.02} ry={rr * 0.96} fill="#000" opacity={0.32 * scale} filter={`url(#${id}-blur)`} />
      <circle cx={x} cy={y + rr * 0.22} r={rr} fill={edge} />
      <circle cx={x} cy={y} r={rr} fill={`url(#${id}-${kind})`} />
      <circle cx={x} cy={y} r={rr * 0.58} fill="none" stroke={ring} strokeWidth={rr * 0.1} opacity="0.85" />
      <ellipse cx={x - rr * 0.33} cy={y - rr * 0.38} rx={rr * 0.38} ry={rr * 0.22} fill="#fff" opacity={kind === 'black' ? 0.28 : 0.55} transform={`rotate(-30 ${x - rr * 0.33} ${y - rr * 0.38})`} />
    </g>
  )
}

export function CarromBoard({ view, seats, mySeat, isMyTurn, sendMove }: BoardProps<CarromState>) {
  const s = view.state
  const gid = 'crm'
  const flip = mySeat === 1 // each player sees their own baseline at the bottom
  const [position, setPosition] = useState(0.5)
  const [power, setPower] = useState(0.65)
  const [aim, setAim] = useState<{ x: number; y: number } | null>(null)
  const [locked, setLocked] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [bodies, setBodies] = useState<Body[] | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const playedSeq = useRef(view.seq)

  // Slow-motion replay of the server-simulated shot, interpolated every animation frame.
  useEffect(() => {
    if (view.seq === playedSeq.current || !s.lastShot) {
      playedSeq.current = view.seq
      return
    }
    playedSeq.current = view.seq
    const frames = s.lastShot.frames
    const count = frames[0].length / 2
    const total = (frames.length - 1) * FRAME_MS
    const pocketedBefore = new Set<number>()
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const ms = (now - t0) * PLAYBACK_SPEED
      if (ms >= total) {
        setBodies(null)
        return
      }
      const next = sample(frames, ms, count)
      next.forEach((b, i) => {
        if (b.scale < 1 && !pocketedBefore.has(i)) {
          pocketedBefore.add(i)
          play(i === 0 ? 'capture' : 'move')
        }
      })
      setBodies(next)
      raf = requestAnimationFrame(tick)
    }
    play('dice')
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [view.seq, s.lastShot])

  // Fresh aim each new turn.
  useEffect(() => {
    if (isMyTurn) {
      setLocked(false)
      setAim(null)
    }
  }, [isMyTurn, view.seq])

  const myBaseline = mySeat !== null ? BASELINE_Y[mySeat] : 82
  const striker = { x: strikerX(position), y: myBaseline }
  const angle = useMemo(() => {
    if (!aim) return mySeat === 1 ? Math.PI / 2 : -Math.PI / 2
    return Math.atan2(aim.y - striker.y, aim.x - striker.x)
  }, [aim, striker.x, striker.y, mySeat])
  const forwardOk = mySeat === 1 ? Math.sin(angle) > 0.05 : Math.sin(angle) < -0.05
  const animating = bodies !== null
  const canShoot = isMyTurn && !busy && !animating
  const overlaps = s.coins.some((c) => !c.pocketed && Math.hypot(c.x - striker.x, c.y - striker.y) < COIN_R + STRIKER_R)

  const toBoard = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect()
    let x = ((e.clientX - rect.left) / rect.width) * (100 + FRAME * 2) - FRAME
    let y = ((e.clientY - rect.top) / rect.height) * (100 + FRAME * 2) - FRAME
    if (flip) {
      x = 100 - x
      y = 100 - y
    }
    return { x, y }
  }
  const positionFromX = (x: number) => clamp((x - BASELINE_X[0]) / (BASELINE_X[1] - BASELINE_X[0]), 0, 1)

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!canShoot || e.button === 2) return
    const p = toBoard(e)
    // Grab the striker to slide it along the baseline.
    if (Math.hypot(p.x - striker.x, p.y - striker.y) < STRIKER_R * 2.2) {
      setDragging(true)
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      return
    }
    // Touch screens have no right-click: a tap sets and locks the aim.
    if (e.pointerType !== 'mouse') {
      setAim(p)
      setLocked(true)
    }
  }
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!canShoot) return
    const p = toBoard(e)
    if (dragging) setPosition(positionFromX(p.x))
    else if (!locked && e.pointerType === 'mouse') setAim(p)
  }
  const onPointerUp = () => setDragging(false)
  /** Right-click locks the aim line on the point under the cursor; right-click again unlocks it. */
  const onContextMenu = (e: MouseEvent<SVGSVGElement>) => {
    e.preventDefault()
    if (!canShoot) return
    play('click')
    if (locked) setLocked(false)
    else {
      setAim(toBoard(e))
      setLocked(true)
    }
  }
  const onWheel = (e: React.WheelEvent) => {
    if (!canShoot) return
    setPower((p) => clamp(Math.round((p - Math.sign(e.deltaY) * 0.05) * 100) / 100, 0.1, 1))
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (!canShoot) return
    const step = flip ? -0.02 : 0.02
    if (e.key === 'ArrowLeft') setPosition((p) => clamp(p - step, 0, 1))
    else if (e.key === 'ArrowRight') setPosition((p) => clamp(p + step, 0, 1))
    else if (e.key === 'ArrowUp') setPower((p) => clamp(p + 0.05, 0.1, 1))
    else if (e.key === 'ArrowDown') setPower((p) => clamp(p - 0.05, 0.1, 1))
    else if (e.key === ' ' || e.key === 'Enter') shoot()
    else return
    e.preventDefault()
  }

  const shoot = () => {
    if (!canShoot || !forwardOk || overlaps) return
    setBusy(true)
    sendMove({ type: 'shot', position: Math.round(position * 1000) / 1000, angle, power })
      .catch(() => {})
      .finally(() => setBusy(false))
  }

  // Aiming guide: path to the first coin (with a ghost striker and the coin's likely direction) or to the cushion + one bounce.
  const guide = useMemo(() => {
    if (!canShoot) return null
    const dx = Math.cos(angle), dy = Math.sin(angle)
    const hit = firstHit(striker.x, striker.y, dx, dy, s.coins)
    const wall = toWall(striker.x, striker.y, dx, dy)
    if (hit && hit.t < wall.t) {
      const gx = striker.x + dx * hit.t, gy = striker.y + dy * hit.t
      const nx = hit.coin.x - gx, ny = hit.coin.y - gy
      const nl = Math.hypot(nx, ny) || 1
      return { end: [gx, gy] as const, ghost: [gx, gy] as const, coinPath: [hit.coin.x, hit.coin.y, hit.coin.x + (nx / nl) * 14, hit.coin.y + (ny / nl) * 14] as const, bounce: null }
    }
    const ex = striker.x + dx * wall.t, ey = striker.y + dy * wall.t
    const rx = wall.nx ? -dx : dx, ry = wall.nx ? dy : -dy
    return { end: [ex, ey] as const, ghost: null, coinPath: null, bounce: [ex, ey, ex + rx * 16, ey + ry * 16] as const }
  }, [canShoot, angle, striker.x, striker.y, s.coins])

  const live = bodies ?? null
  const remaining = (kind: Coin['kind']) => s.coins.filter((c) => c.kind === kind && !c.pocketed).length
  const lineColor = forwardOk && !overlaps ? '#a78bfa' : '#ef4444'

  return (
    <div className="mx-auto flex w-full max-w-[min(94vw,600px,calc(100dvh-440px))] min-w-[200px] flex-col gap-2 sm:gap-4 land:grid land:max-w-full land:grid-cols-[auto_minmax(220px,300px)] land:items-start land:justify-center land:gap-x-6">
      <div className="grid grid-cols-2 gap-2 text-center land:col-start-2 land:row-start-1">
        {[0, 1].map((seat) => (
          <div key={seat} className={`rounded-xl border px-3 py-1.5 transition ${s.turnSeat === seat ? 'border-primary-2 bg-primary/15 shadow-[0_0_24px_-10px_var(--primary)]' : 'border-line'}`}>
            <p className="flex items-center justify-center gap-1.5 truncate text-xs text-muted">
              <MiniCoin kind={seat === 0 ? 'white' : 'black'} />
              {seats[seat]?.displayName}
            </p>
            <p className="font-display text-xl font-bold sm:text-2xl">{s.scores[seat]}</p>
            <p className="text-[10px] text-subtle">{9 - remaining(seat === 0 ? 'white' : 'black')}/9 pocketed</p>
          </div>
        ))}
      </div>

      <div className="relative land:col-start-1 land:row-span-4 land:row-start-1 land:w-[min(640px,calc(100dvh-215px))] short:w-[calc(100dvh-140px)]">
        <svg
          ref={svgRef}
          viewBox={VIEW}
          className={`block w-full touch-none select-none rounded-[1.4rem] outline-none drop-shadow-[0_24px_30px_rgba(0,0,0,.55)] ${canShoot ? (dragging ? 'cursor-grabbing' : 'cursor-crosshair') : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={onContextMenu}
          onWheel={onWheel}
          onKeyDown={onKeyDown}
          tabIndex={canShoot ? 0 : -1}
          role="img"
          aria-label="Carrom board"
        >
          <defs>
            <linearGradient id={`${gid}-frame`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#9a5a24" />
              <stop offset=".5" stopColor="#6b3a14" />
              <stop offset="1" stopColor="#3f200a" />
            </linearGradient>
            <radialGradient id={`${gid}-surface`} cx="45%" cy="40%" r="75%">
              <stop offset="0" stopColor="#fbe9c2" />
              <stop offset=".65" stopColor="#efd29b" />
              <stop offset="1" stopColor="#d9b27a" />
            </radialGradient>
            <pattern id={`${gid}-grain`} width="100" height="6" patternUnits="userSpaceOnUse">
              <path d="M0 2 Q25 0.6 50 2 T100 2" fill="none" stroke="#b07a3a" strokeWidth=".18" opacity=".35" />
              <path d="M0 4.6 Q30 5.8 60 4.4 T100 4.8" fill="none" stroke="#c08a48" strokeWidth=".12" opacity=".25" />
            </pattern>
            <radialGradient id={`${gid}-pocket`} cx="50%" cy="45%" r="55%">
              <stop offset="0" stopColor="#000" />
              <stop offset=".7" stopColor="#140c06" />
              <stop offset="1" stopColor="#3a2412" />
            </radialGradient>
            {(
              [
                ['white', '#fffdf6', '#efe6d0', '#c9b98f'],
                ['black', '#6e625c', '#2b2523', '#0c0908'],
                ['queen', '#fecaca', '#dc2626', '#7f1d1d'],
                ['striker', '#e0f2fe', '#60a5fa', '#1e3a8a'],
              ] as const
            ).map(([k, a, b, c]) => (
              <radialGradient key={k} id={`${gid}-${k}`} cx="35%" cy="30%" r="75%">
                <stop offset="0" stopColor={a} />
                <stop offset=".55" stopColor={b} />
                <stop offset="1" stopColor={c} />
              </radialGradient>
            ))}
            <filter id={`${gid}-blur`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation=".45" />
            </filter>
          </defs>

          {/* bevelled wooden frame */}
          <rect x={-FRAME} y={-FRAME} width={100 + FRAME * 2} height={100 + FRAME * 2} rx="5" fill={`url(#${gid}-frame)`} />
          <rect x={-FRAME + 0.6} y={-FRAME + 0.6} width={100 + FRAME * 2 - 1.2} height={100 + FRAME * 2 - 1.2} rx="4.5" fill="none" stroke="#d99a5b" strokeOpacity=".55" strokeWidth=".6" />
          <rect x="-1" y="-1" width="102" height="102" fill="#2a1406" opacity=".7" />

          <g transform={flip ? 'rotate(180 50 50)' : undefined}>
            {/* playing surface with lighting and grain */}
            <rect width="100" height="100" fill={`url(#${gid}-surface)`} />
            <rect width="100" height="100" fill={`url(#${gid}-grain)`} />
            <rect x=".3" y=".3" width="99.4" height="99.4" fill="none" stroke="#000" strokeOpacity=".25" strokeWidth=".6" />

            {/* markings */}
            <rect x="12" y="12" width="76" height="76" fill="none" stroke="#7c4a1e" strokeWidth=".35" />
            <circle cx="50" cy="50" r="11" fill="none" stroke="#7c4a1e" strokeWidth=".35" />
            <circle cx="50" cy="50" r="12.2" fill="none" stroke="#7c4a1e" strokeWidth=".15" />
            <circle cx="50" cy="50" r="2.4" fill="none" stroke="#b91c1c" strokeWidth=".35" />
            {[0, 45, 90, 135].map((d) => (
              <path key={d} d="M50 39.5 L51.2 44 L50 45.2 L48.8 44 Z" fill="#b91c1c" opacity=".55" transform={`rotate(${d} 50 50)`} />
            ))}
            {[[12, 12, 1], [88, 12, -1], [12, 88, -1], [88, 88, 1]].map(([x, y]) => (
              <line key={`${x}${y}`} x1={x} y1={y} x2={x < 50 ? x - 5 : x + 5} y2={y < 50 ? y - 5 : y + 5} stroke="#7c4a1e" strokeWidth=".3" />
            ))}
            {BASELINE_Y.map((y) => (
              <g key={y}>
                <line x1={BASELINE_X[0]} x2={BASELINE_X[1]} y1={y - 2.4} y2={y - 2.4} stroke="#7c4a1e" strokeWidth=".3" />
                <line x1={BASELINE_X[0]} x2={BASELINE_X[1]} y1={y + 2.4} y2={y + 2.4} stroke="#7c4a1e" strokeWidth=".3" />
                {BASELINE_X.map((x) => (
                  <g key={x}>
                    <circle cx={x} cy={y} r="2.4" fill="#b91c1c" opacity=".85" />
                    <circle cx={x} cy={y} r="1.5" fill="none" stroke="#fde68a" strokeWidth=".2" opacity=".7" />
                  </g>
                ))}
              </g>
            ))}

            {/* pockets with depth */}
            {POCKETS.map(([x, y]) => (
              <g key={`${x}${y}`}>
                <circle cx={x} cy={y} r={POCKET_R + 0.6} fill="#5b3410" />
                <circle cx={x} cy={y} r={POCKET_R} fill={`url(#${gid}-pocket)`} />
                <circle cx={x} cy={y} r={POCKET_R - 0.4} fill="none" stroke="#000" strokeWidth=".6" opacity=".6" />
              </g>
            ))}

            {/* motion trails while the replay runs */}
            {live?.map((b, i) =>
              b.trail ? (
                <line key={`t${i}`} x1={b.trail[0]} y1={b.trail[1]} x2={b.x} y2={b.y} stroke={i === 0 ? '#60a5fa' : s.coins[i - 1]?.kind === 'black' ? '#2b2523' : s.coins[i - 1]?.kind === 'queen' ? '#dc2626' : '#fffdf6'} strokeWidth={b.r * 1.2} strokeLinecap="round" opacity=".22" />
              ) : null,
            )}

            {/* coins */}
            {s.coins.map((c, i) => {
              const b = live?.[i + 1]
              if (b) return b.scale > 0 ? <Disc key={c.id} id={gid} x={b.x} y={b.y} r={COIN_R} kind={c.kind} scale={b.scale} /> : null
              return c.pocketed ? null : <Disc key={c.id} id={gid} x={c.x} y={c.y} r={COIN_R} kind={c.kind} />
            })}

            {/* striker in flight */}
            {live && live[0].scale > 0 && <Disc id={gid} x={live[0].x} y={live[0].y} r={STRIKER_R} kind="striker" scale={live[0].scale} />}

            {/* aiming: guide line, ghost striker, predicted coin path, power ring, draggable striker */}
            {canShoot && guide && (
              <g pointerEvents="none">
                <line x1={striker.x} y1={striker.y} x2={guide.end[0]} y2={guide.end[1]} stroke={lineColor} strokeWidth={locked ? 0.6 : 0.4} strokeDasharray="1.4 0.9" />
                {guide.bounce && <line x1={guide.bounce[0]} y1={guide.bounce[1]} x2={guide.bounce[2]} y2={guide.bounce[3]} stroke={lineColor} strokeWidth=".3" strokeDasharray="0.8 1" opacity=".55" />}
                {guide.ghost && <circle cx={guide.ghost[0]} cy={guide.ghost[1]} r={STRIKER_R} fill="#60a5fa" fillOpacity=".15" stroke="#93c5fd" strokeWidth=".3" strokeDasharray=".8 .6" />}
                {guide.coinPath && <line x1={guide.coinPath[0]} y1={guide.coinPath[1]} x2={guide.coinPath[2]} y2={guide.coinPath[3]} stroke="#fbbf24" strokeWidth=".4" strokeDasharray="1 .7" opacity=".9" />}
                {locked && aim && (
                  <g>
                    <circle cx={aim.x} cy={aim.y} r="1.6" fill="none" stroke="#a78bfa" strokeWidth=".35" />
                    <line x1={aim.x - 2.4} y1={aim.y} x2={aim.x + 2.4} y2={aim.y} stroke="#a78bfa" strokeWidth=".25" />
                    <line x1={aim.x} y1={aim.y - 2.4} x2={aim.x} y2={aim.y + 2.4} stroke="#a78bfa" strokeWidth=".25" />
                  </g>
                )}
              </g>
            )}
            {canShoot && (
              <g>
                <circle cx={striker.x} cy={striker.y} r={STRIKER_R + 1.1} fill="none" stroke="#000" strokeOpacity=".2" strokeWidth=".7" />
                <circle
                  cx={striker.x}
                  cy={striker.y}
                  r={STRIKER_R + 1.1}
                  fill="none"
                  stroke={power > 0.8 ? '#ef4444' : power > 0.5 ? '#f59e0b' : '#22c55e'}
                  strokeWidth=".7"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * (STRIKER_R + 1.1) * power} 999`}
                  transform={`rotate(-90 ${striker.x} ${striker.y})`}
                />
                <Disc id={gid} x={striker.x} y={striker.y} r={STRIKER_R} kind="striker" />
              </g>
            )}
          </g>
        </svg>

        {canShoot && (
          <div className="pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium text-white backdrop-blur">
            {locked ? <Lock className="size-3 text-violet-300" /> : <LockOpen className="size-3" />}
            {locked ? 'Aim locked · right-click to unlock' : 'Right-click to lock aim · drag striker'}
          </div>
        )}
        {animating && (
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] font-medium text-white">Shot in motion…</div>
        )}
      </div>

      {s.lastShot && !animating && (
        <p className="hidden text-center text-xs text-muted sm:block land:col-start-2 land:text-left" aria-live="polite">
          Last shot ({seats[s.lastShot.seat]?.displayName}): {s.lastShot.summary}
          {s.queenPendingSeat !== null && ' · Queen awaiting cover'}
        </p>
      )}

      {isMyTurn ? (
        <div className="card grid grid-cols-2 gap-x-3 gap-y-2 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:gap-3 sm:p-4 land:col-start-2 land:grid-cols-1 land:items-stretch">
          <Slider label="Striker position" value={position} min={0} max={1} step={0.005} onChange={setPosition} disabled={!canShoot} accent="var(--primary)" dir={flip ? 'rtl' : undefined} />
          <Slider label={<>Power <span className="font-mono">{Math.round(power * 100)}%</span></>} value={power} min={0.1} max={1} step={0.01} onChange={setPower} disabled={!canShoot} accent="var(--gold)" />
          <Button size="lg" variant="gold" className="col-span-2 sm:col-span-1 land:col-span-1" onClick={shoot} disabled={!canShoot || !forwardOk || overlaps} loading={busy}>
            Strike
          </Button>
          <p className="col-span-2 flex items-start gap-1.5 text-[11px] text-subtle sm:col-span-3 land:col-span-1">
            <MousePointerClick className="mt-px size-3.5 shrink-0" />
            {overlaps
              ? 'The striker overlaps a coin — slide it along the baseline.'
              : 'Move the mouse to aim, right-click to lock. Drag the striker or use ← →. Scroll or ↑ ↓ for power, Space to strike. On touch: tap to aim.'}
          </p>
        </div>
      ) : (
        <p className="text-center text-sm text-muted land:col-start-2">{animating ? 'Watch the shot…' : `Waiting for ${seats[s.turnSeat]?.displayName ?? 'opponent'} to strike…`}</p>
      )}
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange, disabled, accent, dir }: { label: ReactNode; value: number; min: number; max: number; step: number; onChange: (v: number) => void; disabled: boolean; accent: string; dir?: 'rtl' }) {
  return (
    <label className="text-xs text-muted">
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} className="mt-2 w-full" style={{ accentColor: accent, direction: dir }} />
    </label>
  )
}

function MiniCoin({ kind }: { kind: 'white' | 'black' }) {
  return (
    <span
      className="inline-block size-3.5 rounded-full"
      style={{ background: kind === 'white' ? 'radial-gradient(circle at 35% 30%, #fffdf6, #efe6d0 55%, #c9b98f)' : 'radial-gradient(circle at 35% 30%, #6e625c, #2b2523 55%, #0c0908)', boxShadow: '0 1px 2px rgba(0,0,0,.5)' }}
      aria-hidden
    />
  )
}
