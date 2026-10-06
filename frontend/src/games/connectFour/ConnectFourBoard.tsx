import { motion } from 'motion/react'
import { useState } from 'react'
import type { BoardProps } from '../types'

interface State {
  grid: (number | null)[][]
  winningCells: [number, number][] | null
  lastDrop: { row: number; col: number } | null
}
const DISC = ['bg-red-500', 'bg-yellow-400']

export function ConnectFourBoard({ view, isMyTurn, sendMove, mySeat }: BoardProps<State>) {
  const [hover, setHover] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const { grid, winningCells, lastDrop } = view.state
  const cols = grid[0].length
  const isWin = (r: number, c: number) => winningCells?.some(([wr, wc]) => wr === r && wc === c)
  const drop = (c: number) => {
    if (!isMyTurn || busy || grid[0][c] !== null) return
    setBusy(true)
    sendMove({ type: 'drop', col: c }).catch(() => {}).finally(() => setBusy(false))
  }
  return (
    <div className="mx-auto w-full max-w-[min(94vw,520px)]">
      <div className="mb-1 grid h-8 grid-cols-7 gap-1.5 px-2" aria-hidden>
        {Array.from({ length: cols }, (_, c) => (
          <div key={c} className="flex justify-center">
            {isMyTurn && hover === c && mySeat !== null && <span className={`size-6 rounded-full ${DISC[mySeat]} opacity-60`} />}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5 rounded-2xl bg-blue-700 p-2 shadow-[inset_0_-6px_0_rgba(0,0,0,.25)] sm:gap-2 sm:p-3" onMouseLeave={() => setHover(null)}>
        {Array.from({ length: cols }, (_, c) => (
          <button
            key={c}
            onClick={() => drop(c)}
            onMouseEnter={() => setHover(c)}
            disabled={!isMyTurn || busy || grid[0][c] !== null}
            aria-label={`Drop disc in column ${c + 1}`}
            className="flex flex-col gap-1.5 rounded-xl transition enabled:hover:bg-white/10 sm:gap-2"
          >
            {grid.map((row, r) => {
              const v = row[c]
              const fresh = lastDrop?.row === r && lastDrop?.col === c
              return (
                <span key={r} className="relative aspect-square w-full overflow-hidden rounded-full bg-[#0b1a4a] shadow-inner">
                  {v !== null && (
                    <motion.span
                      initial={fresh ? { y: `-${(r + 1) * 115}%` } : false}
                      animate={{ y: 0 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                      className={`absolute inset-[6%] rounded-full ${DISC[v]} ${isWin(r, c) ? 'ring-4 ring-white' : ''}`}
                    />
                  )}
                </span>
              )
            })}
          </button>
        ))}
      </div>
    </div>
  )
}
