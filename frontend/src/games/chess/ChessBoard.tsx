import { Flag } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui'
import type { BoardProps } from '../types'

type Piece = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
type Promo = 'q' | 'r' | 'b' | 'n'
interface State {
  board: (Piece | null)[]
  turnSeat: number
  moves: string[]
  lastMove: { from: number; to: number; san: string } | null
  captured: [Piece[], Piece[]]
  check: boolean
  result: { winnerSeat: number | null; reason: string } | null
  /** Only filled for the player on turn: from-square → destination squares. */
  legal: Record<number, number[]>
}

// Square index = rank * 8 + file (a1 = 0, h8 = 63), matching the server engine.
const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const FILES = 'abcdefgh'
const isWhite = (p: Piece) => p === p.toUpperCase()
const name = (sq: number) => `${FILES[sq % 8]}${Math.floor(sq / 8) + 1}`
const REASON: Record<string, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate — draw',
  threefold: 'Draw by threefold repetition',
  'fifty-move': 'Draw by the 50-move rule',
  insufficient: 'Draw — insufficient material',
  resignation: 'Resignation',
}

function PieceGlyph({ piece, className = '' }: { piece: Piece; className?: string }) {
  const white = isWhite(piece)
  return (
    <span
      className={`select-none leading-none ${white ? 'text-white' : 'text-neutral-900'} ${className}`}
      style={{ textShadow: white ? '0 0 1px #000, 0 0 1px #000, 0 2px 3px rgba(0,0,0,.45)' : '0 0 1px #fff8, 0 2px 3px rgba(0,0,0,.35)' }}
    >
      {GLYPH[piece.toLowerCase()]}
    </span>
  )
}

function Captured({ pieces, lead }: { pieces: Piece[]; lead: number }) {
  const sorted = [...pieces].sort((a, b) => VALUE[b.toLowerCase()] - VALUE[a.toLowerCase()])
  return (
    <div className="flex h-6 min-w-0 items-center gap-px overflow-hidden text-lg">
      {sorted.map((p, i) => (
        <PieceGlyph key={i} piece={p} />
      ))}
      {lead > 0 && <span className="ml-1.5 font-mono text-xs text-muted">+{lead}</span>}
    </div>
  )
}

export function ChessBoard({ view, seats, isMyTurn, sendMove, mySeat }: BoardProps<State>) {
  const { board, legal, lastMove, check, turnSeat, result, moves, captured } = view.state
  // Selection is tagged with the position it was made in, so it clears itself whenever the position changes.
  const [pick, setPick] = useState<{ seq: number; sq: number } | null>(null)
  const [promo, setPromo] = useState<{ seq: number; from: number; to: number } | null>(null)
  const selected = pick?.seq === view.seq ? pick.sq : null
  const promotion = promo?.seq === view.seq ? promo : null
  const setSelected = (sq: number | null) => setPick(sq === null ? null : { seq: view.seq, sq })
  const setPromotion = (p: { from: number; to: number } | null) => setPromo(p && { seq: view.seq, ...p })
  const [busy, setBusy] = useState(false)
  const [confirmResign, setConfirmResign] = useState(false)
  const movesRef = useRef<HTMLOListElement>(null)

  const flipped = mySeat === 1
  const myColor = mySeat === 1 ? 1 : 0
  const canMove = isMyTurn && !busy && !result
  const targets = selected !== null ? (legal[selected] ?? []) : []
  const checkedKing = check && !result?.reason.startsWith('resign') ? board.indexOf(turnSeat === 0 ? 'K' : 'k') : -1
  const material = (side: number) => captured[side].reduce((n, p) => n + VALUE[p.toLowerCase()], 0)
  const lead = material(myColor) - material(1 - myColor)

  useEffect(() => {
    movesRef.current?.scrollTo({ left: movesRef.current.scrollWidth, behavior: 'smooth' })
  }, [moves.length])

  const submit = (from: number, to: number, promo?: Promo) => {
    setBusy(true)
    setSelected(null)
    setPromotion(null)
    sendMove({ type: 'move', from, to, ...(promo && { promotion: promo }) })
      .catch(() => {})
      .finally(() => setBusy(false))
  }

  const onSquare = (sq: number) => {
    if (!canMove) return
    if (selected !== null && targets.includes(sq)) {
      const piece = board[selected]
      const lastRank = Math.floor(sq / 8) === (myColor === 0 ? 7 : 0)
      if (piece?.toLowerCase() === 'p' && lastRank) setPromotion({ from: selected, to: sq })
      else submit(selected, sq)
      return
    }
    setSelected(legal[sq]?.length && sq !== selected ? sq : null)
  }

  const resign = () => {
    setConfirmResign(false)
    sendMove({ type: 'resign' }).catch(() => {})
  }

  const nameOf = (seat: number) => (seat === mySeat ? 'You' : (seats.find((s) => s.seat === seat)?.displayName ?? (seat === 0 ? 'White' : 'Black')))
  const status = result
    ? result.winnerSeat === null
      ? REASON[result.reason]
      : `${REASON[result.reason]} — ${nameOf(result.winnerSeat)} ${result.winnerSeat === mySeat ? 'win' : 'wins'}`
    : `${check ? 'Check! ' : ''}${isMyTurn ? 'Your move' : `${nameOf(turnSeat)} to move`} · ${turnSeat === 0 ? 'White' : 'Black'}`

  // Render order: rank 8 at the top for White, rank 1 at the top for Black.
  const squares = Array.from({ length: 64 }, (_, i) => {
    const row = Math.floor(i / 8)
    const col = i % 8
    return flipped ? row * 8 + (7 - col) : (7 - row) * 8 + col
  })
  const moveDelta = (from: number, to: number) => {
    const dir = flipped ? -1 : 1
    return { x: `${((from % 8) - (to % 8)) * 100 * dir}%`, y: `${(Math.floor(to / 8) - Math.floor(from / 8)) * 100 * dir}%` }
  }

  return (
    <div className="mx-auto w-full max-w-[min(94vw,560px,calc(100dvh-330px))] short:max-w-[calc(100dvh-170px)]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Captured pieces={captured[1 - myColor]} lead={-lead} />
      </div>

      <div className="relative">
        <div role="grid" aria-label="Chess board" className="grid aspect-square w-full grid-cols-8 overflow-hidden rounded-xl border-4 border-[#5b3a1e] shadow-[0_20px_50px_-20px_rgba(0,0,0,.7)]">
          {squares.map((sq, i) => {
            const piece = board[sq]
            const dark = (Math.floor(sq / 8) + (sq % 8)) % 2 === 0
            const isTarget = targets.includes(sq)
            const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq)
            const movable = canMove && !!legal[sq]?.length
            const showRank = i % 8 === 0
            const showFile = i >= 56
            return (
              <button
                key={sq}
                role="gridcell"
                onClick={() => onSquare(sq)}
                aria-label={`${name(sq)}${piece ? `, ${isWhite(piece) ? 'white' : 'black'} ${piece.toLowerCase()}` : ''}${isTarget ? ', legal move' : ''}`}
                className={`relative flex aspect-square touch-manipulation items-center justify-center ${dark ? 'bg-[#b58863]' : 'bg-[#f0d9b5]'} ${movable || isTarget ? 'cursor-pointer' : 'cursor-default'}`}
              >
                {isLast && <span className="absolute inset-0 bg-yellow-300/45" />}
                {selected === sq && <span className="absolute inset-0 bg-emerald-400/55" />}
                {checkedKing === sq && <span className="absolute inset-0 bg-[radial-gradient(circle,rgba(239,68,68,.95)_0%,rgba(239,68,68,.5)_45%,transparent_75%)]" />}
                {showRank && <span className={`absolute top-0.5 left-1 text-[9px] font-semibold sm:text-[11px] ${dark ? 'text-[#f0d9b5]' : 'text-[#b58863]'}`}>{Math.floor(sq / 8) + 1}</span>}
                {showFile && <span className={`absolute right-1 bottom-0 text-[9px] font-semibold sm:text-[11px] ${dark ? 'text-[#f0d9b5]' : 'text-[#b58863]'}`}>{FILES[sq % 8]}</span>}
                {piece && (
                  <motion.span
                    key={lastMove?.to === sq ? `${view.seq}` : piece}
                    initial={lastMove?.to === sq ? moveDelta(lastMove.from, sq) : false}
                    animate={{ x: 0, y: 0 }}
                    transition={{ type: 'tween', duration: 0.22, ease: 'easeOut' }}
                    className="relative z-10 flex items-center justify-center"
                  >
                    <PieceGlyph piece={piece} className={`text-[min(9.5vw,52px)] short:text-[min(9vh,44px)] ${movable && selected !== sq ? 'transition hover:scale-110' : ''}`} />
                  </motion.span>
                )}
                {isTarget &&
                  (piece ? (
                    <span className="absolute inset-[4%] z-20 rounded-full border-[5px] border-black/25" />
                  ) : (
                    <span className="absolute z-20 size-[30%] rounded-full bg-black/25" />
                  ))}
              </button>
            )
          })}
        </div>

        <AnimatePresence>
          {promotion && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-30 flex items-center justify-center rounded-xl bg-black/55 backdrop-blur-[2px]" onClick={() => setPromotion(null)}>
              <motion.div initial={{ scale: 0.85 }} animate={{ scale: 1 }} className="rounded-2xl border border-line-2 bg-surface p-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <p className="mb-2 text-center text-xs text-muted">Promote to</p>
                <div className="flex gap-2">
                  {(['q', 'r', 'b', 'n'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => submit(promotion.from, promotion.to, p)}
                      aria-label={{ q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[p]}
                      className="flex size-14 items-center justify-center rounded-xl bg-[#f0d9b5] transition hover:scale-105 hover:bg-[#e8c99b] sm:size-16"
                    >
                      <PieceGlyph piece={(myColor === 0 ? p.toUpperCase() : p) as Piece} className="text-4xl sm:text-5xl" />
                    </button>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <Captured pieces={captured[myColor]} lead={lead} />
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

      <p role="status" className={`mt-1 text-center text-sm font-medium ${check && !result ? 'text-danger' : result ? 'text-gold' : 'text-muted'}`}>{status}</p>

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
