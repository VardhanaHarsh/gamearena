import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
}

/** Cube orientation that shows each value on the front. Faces: front 1, right 2, top 3, bottom 4, left 5, back 6. */
const SHOW: Record<number, [number, number]> = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] }
const FACES: { v: number; t: string }[] = [
  { v: 1, t: 'translateZ(var(--h))' },
  { v: 6, t: 'rotateY(180deg) translateZ(var(--h))' },
  { v: 2, t: 'rotateY(90deg) translateZ(var(--h))' },
  { v: 5, t: 'rotateY(-90deg) translateZ(var(--h))' },
  { v: 3, t: 'rotateX(90deg) translateZ(var(--h))' },
  { v: 4, t: 'rotateX(-90deg) translateZ(var(--h))' },
]

/**
 * A real 3D die. It only DISPLAYS the value the server rolled — clicking sends a roll request,
 * never a number. Each new roll tumbles a few full turns before landing on the server's face.
 */
export function Dice({ value, rollKey, waiting, disabled, onRoll, color }: { value: number | null; rollKey: number; waiting: boolean; disabled: boolean; onRoll: () => void; color: string }) {
  const reduce = useReducedMotion()
  const [spin, setSpin] = useState({ x: -18, y: 22 })
  const lastKey = useRef(rollKey)

  useEffect(() => {
    if (!value) return
    const [bx, by] = SHOW[value]
    const fresh = rollKey !== lastKey.current
    lastKey.current = rollKey
    setSpin((cur) => {
      // keep turning forward (never unwind), adding 2 full tumbles on a fresh roll
      const turns = fresh && !reduce ? 2 : 0
      const nx = Math.ceil((cur.x - bx) / 360) * 360 + bx + turns * 360
      const ny = Math.ceil((cur.y - by) / 360) * 360 + by + turns * 360
      return { x: nx - 18, y: ny + 22 }
    })
  }, [value, rollKey, reduce])

  return (
    <motion.button
      onClick={onRoll}
      disabled={disabled}
      aria-label={disabled ? `Dice showing ${value ?? 'nothing'}` : 'Roll the dice'}
      whileHover={disabled ? undefined : { scale: 1.07 }}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      animate={waiting ? { rotate: [0, -8, 8, -6, 6, 0] } : { rotate: 0 }}
      transition={waiting ? { repeat: Infinity, duration: 0.45 } : { duration: 0.2 }}
      className="relative size-16 shrink-0 touch-manipulation rounded-2xl sm:size-20"
      style={{ perspective: '420px', filter: disabled ? 'saturate(.6) brightness(.9)' : `drop-shadow(0 0 18px ${color})` }}
    >
      <span className="absolute inset-x-2 -bottom-2 h-3 rounded-full bg-black/40 blur-md" aria-hidden />
      <motion.span
        className="absolute inset-[10%] block [--h:25.6px] sm:[--h:32px]"
        style={{ transformStyle: 'preserve-3d' }}
        animate={{ rotateX: spin.x, rotateY: spin.y }}
        transition={{ duration: reduce ? 0 : 0.75, ease: [0.2, 0.7, 0.2, 1] }}
      >
        {FACES.map((f) => (
          <span
            key={f.v}
            className="absolute inset-0 rounded-[22%] border border-slate-200 bg-gradient-to-br from-white to-slate-200 shadow-[inset_0_0_8px_rgba(0,0,0,.15)]"
            style={{ transform: f.t, backfaceVisibility: 'hidden' }}
          >
            <svg viewBox="0 0 100 100" className="size-full" aria-hidden>
              {PIPS[f.v].map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={9.5} fill={f.v === 1 ? color : '#111827'} />
              ))}
            </svg>
          </span>
        ))}
      </motion.span>
      {!value && !disabled && (
        <span className="absolute inset-0 flex items-center justify-center font-display text-sm font-bold" style={{ color }}>
          ROLL
        </span>
      )}
    </motion.button>
  )
}
