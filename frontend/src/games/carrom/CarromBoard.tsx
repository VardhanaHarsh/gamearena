import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Button } from '../../components/ui'
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

// Must match the server engine constants.
const COIN_R = 1.7
const STRIKER_R = 2.3
const BASELINE_Y = [82, 18]
const BASELINE_X = [22, 78]
const POCKETS: [number, number][] = [[3.2, 3.2], [96.8, 3.2], [3.2, 96.8], [96.8, 96.8]]
const FRAME_MS = 1000 / 30
const COIN_FILL = { white: '#f5f0e6', black: '#2b2523', queen: '#dc2626' }

const strikerX = (p: number) => BASELINE_X[0] + p * (BASELINE_X[1] - BASELINE_X[0])

/**
 * The client renders and lets the player choose shot parameters; the SERVER runs the physics.
 * After each shot we replay the server's sampled frames, then snap to the authoritative final state.
 */
export function CarromBoard({ view, seats, mySeat, isMyTurn, sendMove }: BoardProps<CarromState>) {
  const s = view.state
  const flip = mySeat === 1 // each player sees their own baseline at the bottom
  const [position, setPosition] = useState(0.5)
  const [power, setPower] = useState(0.65)
  const [aim, setAim] = useState<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [frame, setFrame] = useState<number[] | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const playedSeq = useRef(view.seq)

  // Replay the latest shot's frames when a new state arrives.
  useEffect(() => {
    if (view.seq === playedSeq.current || !s.lastShot) {
      playedSeq.current = view.seq
      return
    }
    playedSeq.current = view.seq
    const frames = s.lastShot.frames
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const i = Math.floor((t - t0) / FRAME_MS)
      if (i >= frames.length) {
        setFrame(null)
        return
      }
      setFrame(frames[i])
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [view.seq, s.lastShot])

  const myBaseline = mySeat !== null ? BASELINE_Y[mySeat] : 82
  const striker = { x: strikerX(position), y: myBaseline }
  const angle = useMemo(() => {
    if (!aim) return mySeat === 1 ? Math.PI / 2 : -Math.PI / 2
    return Math.atan2(aim.y - striker.y, aim.x - striker.x)
  }, [aim, striker.x, striker.y, mySeat])
  const forwardOk = mySeat === 1 ? Math.sin(angle) > 0.05 : Math.sin(angle) < -0.05
  const animating = frame !== null
  const canShoot = isMyTurn && !busy && !animating

  const toBoard = (e: PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect()
    let x = ((e.clientX - rect.left) / rect.width) * 100
    let y = ((e.clientY - rect.top) / rect.height) * 100
    if (flip) {
      x = 100 - x
      y = 100 - y
    }
    return { x, y }
  }

  const shoot = () => {
    if (!canShoot || !forwardOk) return
    setBusy(true)
    sendMove({ type: 'shot', position: Math.round(position * 1000) / 1000, angle, power })
      .catch(() => {})
      .finally(() => setBusy(false))
  }

  // Positions: animation frame if playing, else authoritative state.
  const bodies = s.coins.map((c, i) => {
    if (frame) {
      const x = frame[2 + i * 2]
      const y = frame[3 + i * 2]
      return { ...c, x, y, pocketed: x < 0 }
    }
    return c
  })
  const animStriker = frame && frame[0] >= 0 ? { x: frame[0], y: frame[1] } : null
  const aimLen = 10 + power * 30

  return (
    <div className="mx-auto flex w-full max-w-[min(94vw,600px,calc(100dvh-420px))] min-w-[280px] flex-col gap-2 sm:gap-4">
      <div className="grid grid-cols-2 gap-2 text-center">
        {[0, 1].map((seat) => (
          <div key={seat} className={`rounded-xl border px-3 py-1 sm:py-2 ${s.turnSeat === seat ? 'border-primary-2 bg-primary/10' : 'border-line'}`}>
            <p className="truncate text-xs text-muted">
              {seat === 0 ? '⚪ White' : '⚫ Black'} · {seats[seat]?.displayName}
            </p>
            <p className="font-display text-xl font-bold sm:text-2xl">{s.scores[seat]}</p>
          </div>
        ))}
      </div>

      <div className="rounded-[1.4rem] bg-gradient-to-br from-amber-900 to-amber-950 p-2 shadow-2xl sm:p-3.5">
        <svg
          ref={svgRef}
          viewBox="0 0 100 100"
          className="block w-full touch-none rounded-xl select-none"
          onPointerMove={(e) => canShoot && setAim(toBoard(e))}
          onPointerDown={(e) => canShoot && setAim(toBoard(e))}
          role="img"
          aria-label="Carrom board"
        >
          <g transform={flip ? 'rotate(180 50 50)' : undefined}>
            <rect width="100" height="100" fill="#f3d9a4" />
            <rect x="12" y="12" width="76" height="76" fill="none" stroke="#7c4a1e" strokeWidth="0.35" />
            <circle cx="50" cy="50" r="11" fill="none" stroke="#7c4a1e" strokeWidth="0.35" />
            <circle cx="50" cy="50" r="2.4" fill="none" stroke="#b91c1c" strokeWidth="0.35" />
            {BASELINE_Y.map((y) => (
              <g key={y}>
                <line x1={BASELINE_X[0]} x2={BASELINE_X[1]} y1={y - 2.4} y2={y - 2.4} stroke="#7c4a1e" strokeWidth="0.3" />
                <line x1={BASELINE_X[0]} x2={BASELINE_X[1]} y1={y + 2.4} y2={y + 2.4} stroke="#7c4a1e" strokeWidth="0.3" />
                <circle cx={BASELINE_X[0]} cy={y} r="2.4" fill="#b91c1c" opacity="0.8" />
                <circle cx={BASELINE_X[1]} cy={y} r="2.4" fill="#b91c1c" opacity="0.8" />
              </g>
            ))}
            {POCKETS.map(([x, y]) => (
              <circle key={`${x}${y}`} cx={x} cy={y} r={4.2} fill="#1c1410" />
            ))}

            {bodies.map((c) =>
              c.pocketed ? null : (
                <g key={c.id}>
                  <circle cx={c.x} cy={c.y} r={COIN_R} fill={COIN_FILL[c.kind]} stroke={c.kind === 'white' ? '#c9bfa8' : '#000'} strokeWidth="0.25" />
                  <circle cx={c.x} cy={c.y} r={COIN_R * 0.55} fill="none" stroke={c.kind === 'black' ? '#4b403c' : '#d6cdb6'} strokeWidth="0.2" />
                </g>
              ),
            )}

            {animStriker && <circle cx={animStriker.x} cy={animStriker.y} r={STRIKER_R} fill="#60a5fa" stroke="#1e3a8a" strokeWidth="0.3" />}

            {canShoot && (
              <g>
                <line
                  x1={striker.x}
                  y1={striker.y}
                  x2={striker.x + Math.cos(angle) * aimLen}
                  y2={striker.y + Math.sin(angle) * aimLen}
                  stroke={forwardOk ? '#7c3aed' : '#dc2626'}
                  strokeWidth="0.45"
                  strokeDasharray="1.2 0.8"
                />
                <circle cx={striker.x} cy={striker.y} r={STRIKER_R} fill="#93c5fd" stroke="#1e3a8a" strokeWidth="0.35" />
              </g>
            )}
          </g>
        </svg>
      </div>

      {s.lastShot && !animating && (
        <p className="truncate text-center text-xs text-muted" aria-live="polite">
          Last shot ({seats[s.lastShot.seat]?.displayName}): {s.lastShot.summary}
          {s.queenPendingSeat !== null && ' · Queen awaiting cover'}
        </p>
      )}

      {isMyTurn ? (
        <div className="card grid grid-cols-2 gap-x-3 gap-y-2 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end sm:gap-3 sm:p-4">
          <label className="text-xs text-muted">
            Striker position
            <input type="range" min={0} max={1} step={0.005} value={position} onChange={(e) => setPosition(Number(e.target.value))} disabled={!canShoot} className="mt-2 w-full accent-[var(--primary)]" style={flip ? { direction: 'rtl' } : undefined} />
          </label>
          <label className="text-xs text-muted">
            Power {Math.round(power * 100)}%
            <input type="range" min={0.1} max={1} step={0.01} value={power} onChange={(e) => setPower(Number(e.target.value))} disabled={!canShoot} className="mt-2 w-full accent-[var(--gold)]" />
          </label>
          <Button size="lg" variant="gold" className="col-span-2 sm:col-span-1" onClick={shoot} disabled={!canShoot || !forwardOk} loading={busy}>
            Strike
          </Button>
          <p className="hidden text-[11px] text-subtle sm:col-span-3 sm:block">Drag or tap on the board to aim (forward only). The server simulates the shot.</p>
        </div>
      ) : (
        <p className="text-center text-sm text-muted">{animating ? 'Shot in motion…' : `Waiting for ${seats[s.turnSeat]?.displayName ?? 'opponent'} to strike…`}</p>
      )}
    </div>
  )
}
