import { motion } from 'motion/react'
import { useState } from 'react'
import type { BoardProps } from '../types'

interface State {
  board: (number | null)[]
  winningLine: number[] | null
}

const MARK = ['✕', '◯']
const COLOR = ['text-primary-2', 'text-cyan']

export function TicTacToeBoard({ view, isMyTurn, sendMove }: BoardProps<State>) {
  const [pending, setPending] = useState<number | null>(null)
  const { board, winningLine } = view.state
  return (
    <div className="mx-auto grid aspect-square w-full max-w-[min(92vw,440px)] grid-cols-3 gap-2 rounded-3xl border border-line bg-surface p-2 sm:gap-3 sm:p-3">
      {board.map((cell, i) => {
        const canPlay = isMyTurn && cell === null && pending === null
        const highlight = winningLine?.includes(i)
        return (
          <button
            key={i}
            disabled={!canPlay}
            aria-label={`Cell ${i + 1}${cell === null ? ', empty' : `, ${cell === 0 ? 'X' : 'O'}`}`}
            onClick={() => {
              setPending(i)
              sendMove({ type: 'place', cell: i }).catch(() => {}).finally(() => setPending(null))
            }}
            className={`flex items-center justify-center rounded-2xl border text-5xl font-bold transition sm:text-7xl ${highlight ? 'border-gold bg-gold/15' : 'border-line-2 bg-bg-2/60'} ${canPlay ? 'hover:border-primary-2 hover:bg-primary/10' : ''}`}
          >
            {cell !== null && (
              <motion.span initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }} className={COLOR[cell]}>
                {MARK[cell]}
              </motion.span>
            )}
          </button>
        )
      })}
    </div>
  )
}
