import { motion } from 'motion/react'

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
}

/** The die only DISPLAYS the value the server rolled — clicking sends a roll request, never a number. */
export function Dice({ value, rolling, disabled, onRoll, color }: { value: number | null; rolling: boolean; disabled: boolean; onRoll: () => void; color: string }) {
  return (
    <motion.button
      onClick={onRoll}
      disabled={disabled}
      aria-label={disabled ? `Dice showing ${value ?? 'nothing'}` : 'Roll the dice'}
      animate={rolling ? { rotate: [0, 90, 180, 270, 360], scale: [1, 1.1, 1] } : { rotate: 0, scale: 1 }}
      transition={rolling ? { repeat: Infinity, duration: 0.5, ease: 'linear' } : { type: 'spring' }}
      whileHover={disabled ? undefined : { scale: 1.06 }}
      whileTap={disabled ? undefined : { scale: 0.92 }}
      className="relative size-20 rounded-2xl border-2 bg-white shadow-xl transition disabled:opacity-70"
      style={{ borderColor: color, boxShadow: disabled ? undefined : `0 0 30px -4px ${color}` }}
    >
      <svg viewBox="0 0 100 100" className="size-full">
        {(value ? PIPS[value] : []).map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={9} fill="#111827" />
        ))}
        {!value && <text x="50" y="62" textAnchor="middle" fontSize="30" fontWeight="700" fill={color}>ROLL</text>}
      </svg>
    </motion.button>
  )
}
