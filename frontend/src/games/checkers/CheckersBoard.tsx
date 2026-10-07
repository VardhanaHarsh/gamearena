import { Crown, Flag } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui'
import type { BoardProps } from '../types'

interface Man {
  seat: number
  king: boolean
}
interface State {
  board: (Man | null)[]
  turnSeat: number
  chainFrom: number | null
  moves: string[]
  lastMove: { path: number[]; captured: number[]; crowned: boolean } | null
  captured: [number, number]
  result: { winnerSeat: number | null; reason: string } | null
  /** Only filled for the player on turn: from-square → destination squares. */
  legal: Record<number, number[]>
  mustCapture: boolean
}

// Square index = row * 8 + col (a1 = 0, h8 = 63), matching the server engine. Seat 0 = Red, seat 1 = Black.
const FILES = 'abcdefgh'
const name = (sq: number) => `${FILES[sq % 8]}${Math.floor(sq / 8) + 1}`
const COLOR_NAME = ['Red', 'Black']
const REASON: Record<string, string> = {
  'no-pieces': 'All pieces captured',
  'no-moves': 'No moves left',
  'forty-move': 'Draw — 40 moves without progress',
  resignation: 'Resignation',
}

function Disc({ man, small = false }: { man: Man; small?: boolean }) {
  const red = man.seat === 0
  return (
    <span
      className={`flex aspect-square items-center justify-center rounded-full border-2 ${small ? 'w-4' : 'w-[78%]'} ${red ? 'border-red-800 bg-[radial-gradient(circle_at_35%_30%,#f87171,#dc2626_55%,#991b1b)]' : 'border-black bg-[radial-gradient(circle_at_35%_30%,#525252,#1f1f1f_55%,#0a0a0a)]'}`}
      style={{ boxShadow: small ? undefined : 'inset 0 -3px 0 rgba(0,0,0,.35), 0 3px 6px rgba(0,0,0,.45)' }}
    >
      {man.king && !small && <Crown className={`size-[48%] ${red ? 'text-yellow-200' : 'text-amber-300'}`} strokeWidth={2.5} aria-hidden />}
    </span>
  )
}

function Captured({ count, seat }: { count: number; seat: number }) {
  return (
    <div className="flex h-6 min-w-0 items-center gap-0.5 overflow-hidden">
      {Array.from({ length: count }, (_, i) => (
        <Disc key={i} man={{ seat, king: false }} small />
      ))}
    </div>
  )
}

export function CheckersBoard({ view, seats, isMyTurn, sendMove, mySeat }: BoardProps<State>) {
  const { board, legal, lastMove, turnSeat, result, moves, captured, chainFrom, mustCapture } = view.state
  // Selection is tagged with the position it was made in, so it clears itself whenever the position changes.
  const [pick, setPick] = useState<{ seq: number; sq: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmResign, setConfirmResign] = useState(false)
  const movesRef = useRef<HTMLOListElement>(null)

  const flipped = mySeat === 1
  const mine = mySeat === 1 ? 1 : 0
  const canMove = isMyTurn && !busy && !result
  // Mid multi-jump the chaining piece is the only one that may move, so keep it selected.
  const selected = chainFrom ?? (pick?.seq === view.seq ? pick.sq : null)
  const targets = selected !== null ? (legal[selected] ?? []) : []

  useEffect(() => {
    movesRef.current?.scrollTo({ left: movesRef.current.scrollWidth, behavior: 'smooth' })
  }, [moves.length])

  const onSquare = (sq: number) => {
    if (!canMove) return
    if (selected !== null && targets.includes(sq)) {
      setBusy(true)
      setPick(null)
      sendMove({ type: 'move', from: selected, to: sq })
        .catch(() => {})
        .finally(() => setBusy(false))
      return
    }
    if (chainFrom !== null) return
    setPick(legal[sq]?.length && sq !== selected ? { seq: view.seq, sq } : null)
  }

  const resign = () => {
    setConfirmResign(false)
    sendMove({ type: 'resign' }).catch(() => {})
  }

  const nameOf = (seat: number) => (seat === mySeat ? 'You' : (seats.find((s) => s.seat === seat)?.displayName ?? COLOR_NAME[seat]))
  const status = result
    ? result.winnerSeat === null
      ? REASON[result.reason]
      : `${REASON[result.reason]} — ${nameOf(result.winnerSeat)} ${result.winnerSeat === mySeat ? 'win' : 'wins'}`
    : isMyTurn
      ? chainFrom !== null
        ? 'Keep jumping!'
        : mustCapture
          ? 'Your move — you must capture'
          : 'Your move'
      : `${nameOf(turnSeat)} to move · ${COLOR_NAME[turnSeat]}`

  // Render order: row 8 at the top for Red, row 1 at the top for Black.
  const squares = Array.from({ length: 64 }, (_, i) => {
    const row = Math.floor(i / 8)
    const col = i % 8
    return flipped ? row * 8 + (7 - col) : (7 - row) * 8 + col
  })
  const lastTo = lastMove?.path.at(-1)
  const lastFrom = lastMove?.path.at(-2)
  const moveDelta = (from: number, to: number) => {
    const dir = flipped ? -1 : 1
    return { x: `${((from % 8) - (to % 8)) * 100 * dir}%`, y: `${(Math.floor(to / 8) - Math.floor(from / 8)) * 100 * dir}%` }
  }

  return (
    <div className="mx-auto w-full max-w-[min(94vw,560px,calc(100dvh-330px))] short:max-w-[calc(100dvh-170px)]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Captured count={captured[1 - mine]} seat={mine} />
      </div>

      <div role="grid" aria-label="Checkers board" className="grid aspect-square w-full grid-cols-8 overflow-hidden rounded-xl border-4 border-[#3f2a14] shadow-[0_20px_50px_-20px_rgba(0,0,0,.7)]">
        {squares.map((sq, i) => {
          const man = board[sq]
          const dark = (Math.floor(sq / 8) + (sq % 8)) % 2 === 0
          const isTarget = targets.includes(sq)
          const onPath = lastMove?.path.includes(sq)
          const movable = canMove && !!legal[sq]?.length
          return (
            <button
              key={sq}
              role="gridcell"
              disabled={!dark}
              onClick={() => onSquare(sq)}
              aria-label={`${name(sq)}${man ? `, ${COLOR_NAME[man.seat].toLowerCase()} ${man.king ? 'king' : 'man'}` : ''}${isTarget ? ', legal move' : ''}`}
              className={`relative flex aspect-square touch-manipulation items-center justify-center ${dark ? 'bg-[#769656]' : 'bg-[#eeeed2]'} ${movable || isTarget ? 'cursor-pointer' : 'cursor-default'}`}
            >
              {onPath && <span className="absolute inset-0 bg-yellow-300/40" />}
              {selected === sq && <span className="absolute inset-0 bg-sky-300/50" />}
              {movable && mustCapture && selected !== sq && <span className="absolute inset-[6%] rounded-full ring-2 ring-yellow-300/90" />}
              {i % 8 === 0 && <span className={`absolute top-0.5 left-1 text-[9px] font-semibold sm:text-[11px] ${dark ? 'text-[#eeeed2]' : 'text-[#769656]'}`}>{Math.floor(sq / 8) + 1}</span>}
              {i >= 56 && <span className={`absolute right-1 bottom-0 text-[9px] font-semibold sm:text-[11px] ${dark ? 'text-[#eeeed2]' : 'text-[#769656]'}`}>{FILES[sq % 8]}</span>}
              {man && (
                <motion.span
                  key={lastTo === sq ? `${view.seq}` : 'still'}
                  initial={lastTo === sq && lastFrom !== undefined ? moveDelta(lastFrom, sq) : false}
                  animate={{ x: 0, y: 0 }}
                  transition={{ type: 'tween', duration: 0.24, ease: 'easeOut' }}
                  className={`relative z-10 flex size-full items-center justify-center ${movable && selected !== sq ? 'transition hover:scale-105' : ''}`}
                >
                  <Disc man={man} />
                </motion.span>
              )}
              <AnimatePresence>
                {lastMove?.captured.includes(sq) && !man && (
                  <motion.span key={`gone-${view.seq}`} initial={{ scale: 1, opacity: 0.7 }} animate={{ scale: 1.4, opacity: 0 }} transition={{ duration: 0.4 }} className="absolute inset-[15%] rounded-full bg-white/60" />
                )}
              </AnimatePresence>
              {isTarget && <span className="absolute z-20 size-[30%] rounded-full bg-black/30" />}
            </button>
          )
        })}
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <Captured count={captured[mine]} seat={1 - mine} />
        {mySeat !== null && !result && (
          <AnimatePresence mode="wait" initial={false}>
            {confirmResign ? (
              <motion.div key="confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex shrink-0 gap-1">
                <Button size="sm" variant="danger" onClick={resign}>Resign</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmResign(false)}>Cancel</Button>
              </motion.div>
            ) : (
              <motion.div key="ask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Button size="sm" variant="ghost" icon={<Flag className="size-3.5" />} onClick={() => setConfirmResign(true)}>Resign</Button>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      <p role="status" className={`mt-1 text-center text-sm font-medium ${result ? 'text-gold' : isMyTurn && (mustCapture || chainFrom !== null) ? 'text-danger' : 'text-muted'}`}>{status}</p>

      {moves.length > 0 && (
        <ol ref={movesRef} aria-label="Moves" className="mt-2 flex gap-3 overflow-x-auto rounded-xl border border-line bg-surface px-3 py-1.5 font-mono text-xs whitespace-nowrap short:hidden">
          {Array.from({ length: Math.ceil(moves.length / 2) }, (_, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-subtle">{i + 1}.</span>
              <span className={i * 2 === moves.length - 1 ? 'text-primary-2' : ''}>{moves[i * 2]}</span>
              {moves[i * 2 + 1] && <span className={i * 2 + 1 === moves.length - 1 ? 'text-primary-2' : ''}>{moves[i * 2 + 1]}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
