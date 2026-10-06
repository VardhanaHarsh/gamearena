import { useQueryClient } from '@tanstack/react-query'
import { Bot, Check, Copy, Crown, DoorOpen, Send, Trophy, Wifi, WifiOff } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Modal } from '../components/Modal'
import { Avatar, Badge, Button, Credits, EmptyState, Spinner, inputClass, statusTone } from '../components/ui'
import { BOARDS } from '../games/registry'
import { SEAT_COLORS } from '../games/types'
import { useRoom } from '../hooks/useRoom'
import { gameStyle } from '../lib/games'
import { play } from '../services/sound'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'
import type { RoomView, Seat } from '../types/api'

const TURN_MS = 25_000

/** Ticks on its own so only this tiny element re-renders, not the whole room or board. */
function useClock(active: boolean, offset: number, every = 250) {
  const [now, setNow] = useState(() => Date.now() + offset)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now() + offset), every)
    return () => clearInterval(t)
  }, [active, offset, every])
  return now
}

function TurnBar({ deadline, offset }: { deadline: number | null | undefined; offset: number }) {
  const now = useClock(!!deadline, offset)
  if (!deadline) return null
  const left = Math.max(0, deadline - now)
  return (
    <div className="absolute inset-x-0 bottom-0 h-1 bg-surface-2" aria-hidden>
      <div className={`h-1 transition-[width] duration-200 ${left < 6000 ? 'bg-danger' : 'bg-primary-2'}`} style={{ width: `${Math.min(100, (left / TURN_MS) * 100)}%` }} />
    </div>
  )
}

function TurnSeconds({ deadline, offset }: { deadline: number | null | undefined; offset: number }) {
  const now = useClock(!!deadline, offset, 500)
  if (!deadline) return null
  const left = Math.max(0, Math.ceil((deadline - now) / 1000))
  return <span className={`font-mono text-[11px] ${left <= 6 ? 'text-danger' : 'text-muted'}`}>{left}s</span>
}

function Countdown({ endsAt, offset }: { endsAt: number; offset: number }) {
  const now = useClock(true, offset, 200)
  const n = Math.max(0, Math.ceil((endsAt - now) / 1000))
  return (
    <motion.p key={n} initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="font-display text-8xl font-bold text-gradient">
      {n}
    </motion.p>
  )
}

/** Compact, always-visible turn indicator for phones (the full seat cards sit below the fold there). */
function PlayerStrip({ seats, currentSeat, deadline, offset, mySeat }: { seats: Seat[]; currentSeat: number | null; deadline: number | null; offset: number; mySeat: number | null }) {
  return (
    <div className="-mx-3 mb-3 flex gap-2 overflow-x-auto px-3 pb-1 lg:hidden short:mb-1" role="list" aria-label="Players">
      {seats.map((s) => {
        const turn = currentSeat === s.seat
        return (
          <div key={s.seat} role="listitem" className={`relative flex shrink-0 items-center gap-2 overflow-hidden rounded-xl border py-1.5 pr-3 pl-1.5 ${turn ? 'border-primary-2 bg-primary/15' : 'border-line bg-surface'} ${s.status === 'FORFEITED' ? 'opacity-40' : ''}`}>
            <Avatar avatar={s.avatar} size={28} ring={SEAT_COLORS[s.seat]} />
            <span className="max-w-24 truncate text-xs font-medium">{s.seat === mySeat ? 'You' : s.displayName}</span>
            {!s.connected && !s.isBot && <WifiOff className="size-3 text-danger" aria-label="Disconnected" />}
            {turn && <TurnSeconds deadline={deadline} offset={offset} />}
            {turn && <TurnBar deadline={deadline} offset={offset} />}
          </div>
        )
      })}
    </div>
  )
}

function SeatCard({ seat, room, current, deadline, offset = 0 }: { seat: Seat | undefined; room: RoomView; current?: boolean; deadline?: number | null; offset?: number }) {
  if (!seat) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line-2 p-3 text-sm text-subtle">
        <span className="flex size-10 items-center justify-center rounded-full border border-dashed border-line-2">?</span>
        Waiting for player…
      </div>
    )
  }
  return (
    <motion.div layout className={`relative overflow-hidden rounded-2xl border p-3 transition ${current ? 'border-primary-2 bg-primary/10 shadow-[0_0_30px_-12px_var(--primary)]' : 'border-line bg-surface'}`}>
      <div className="flex items-center gap-3">
        <Avatar avatar={seat.avatar} size={40} ring={SEAT_COLORS[seat.seat]} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
            {seat.isBot && <Bot className="size-3.5 text-cyan" />}
            {seat.displayName}
            {seat.userId === room.hostId && <Crown className="size-3.5 text-gold" aria-label="Host" />}
          </p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted">
            {seat.status === 'FORFEITED' ? (
              <span className="text-danger">Forfeited</span>
            ) : seat.connected ? (
              <><Wifi className="size-3 text-success" /> Online</>
            ) : (
              <><WifiOff className="size-3 text-danger" /> Disconnected</>
            )}
          </p>
        </div>
        {(room.status === 'WAITING' || room.status === 'READY') && (seat.isReady ? <Badge tone="success">Ready</Badge> : <Badge>Not ready</Badge>)}
      </div>
      {current && <TurnBar deadline={deadline} offset={offset} />}
    </motion.div>
  )
}

export function Room() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const me = useAuth((s) => s.user)
  const qc = useQueryClient()
  const { room, game, error, mySeat, clockOffset, sendMove, setReady, start, leave, invite } = useRoom(id)
  const [inviteName, setInviteName] = useState('')
  const [copied, setCopied] = useState(false)
  const [showResult, setShowResult] = useState(false)
  const [busy, setBusy] = useState(false)
  const inGame = room?.status === 'IN_PROGRESS' || room?.status === 'COMPLETED'

  useEffect(() => {
    if (room?.status === 'COMPLETED' && room.result) setShowResult(true)
  }, [room?.status, room?.result])

  if (error) return <div className="mx-auto max-w-lg px-4 py-16"><EmptyState icon="🚪" title="Unable to open room" body={error} action={<Link to="/lobby" className="text-primary-2">Back to lobby</Link>} /></div>
  if (!room) return <Spinner label="Connecting to room" />

  const Board = BOARDS[room.gameKey]
  const st = gameStyle(room.gameKey)
  const mine = room.seats.find((s) => s.userId === me?.id)
  const isHost = room.hostId === me?.id
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true)
    try {
      await fn()
      after?.()
    } catch (e) {
      play('error')
      useUi.getState().toast({ kind: 'error', title: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const doLeave = () =>
    run(leave, () => {
      void qc.invalidateQueries({ queryKey: ['me'] })
      navigate('/lobby')
    })
  const shareUrl = `${location.origin}/room/${room.id}`
  const winnerSeat = room.result?.winnerSeat
  const myPayout = room.result?.payouts.find((p) => p.userId === me?.id)?.amount ?? 0
  const myEntry = mine && !room.isPractice ? room.entryFee : 0
  const net = myPayout - myEntry

  return (
    <div className="mx-auto max-w-7xl px-3 py-3 sm:px-6 sm:py-6 short:py-1">
      <header className="mb-3 flex flex-wrap items-center gap-2 sm:mb-6 sm:gap-3 short:hidden">
        <span className="hidden size-12 items-center justify-center rounded-2xl text-3xl sm:flex" style={{ background: `linear-gradient(135deg, ${st.from}44, ${st.to}44)` }}>{st.emoji}</span>
        <div className="mr-auto">
          <h1 className="font-display text-xl font-bold sm:text-2xl">
            {room.gameName} {room.isPractice && <Badge tone="primary">Practice</Badge>}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
            Room <span className="font-mono text-fg">#{room.code}</span>
            <Badge tone={statusTone(room.status)}>{room.status.replace('_', ' ')}</Badge>
          </p>
        </div>
        {!room.isPractice && (
          <div className="flex gap-2 text-center">
            <div className="hidden rounded-xl border border-line px-3 py-1.5 sm:block">
              <p className="text-[10px] text-subtle uppercase">Entry</p>
              <Credits amount={room.entryFee} size="sm" />
            </div>
            <div className="rounded-xl border border-gold/40 bg-gold/10 px-3 py-1.5">
              <p className="text-[10px] text-subtle uppercase">Prize pool</p>
              <Credits amount={room.prizePool} size="sm" />
            </div>
          </div>
        )}
      </header>

      {!inGame ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <section className="card relative overflow-hidden p-5 sm:p-6">
            <h2 className="mb-4 font-display text-lg font-semibold">Players {room.seats.length}/{room.maxPlayers}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: room.maxPlayers }, (_, i) => (
                <SeatCard key={i} seat={room.seats[i]} room={room} />
              ))}
            </div>
            <AnimatePresence>
              {room.countdownEndsAt !== null && room.status === 'STARTING' && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center bg-bg/85 backdrop-blur" role="status">
                  <p className="text-sm text-muted">Game starting in</p>
                  <Countdown endsAt={room.countdownEndsAt} offset={clockOffset} />
                </motion.div>
              )}
            </AnimatePresence>
            {room.status === 'CANCELLED' && <p className="mt-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">This room was cancelled. Entry fees were refunded.</p>}
          </section>

          <aside className="space-y-4">
            {mine && (room.status === 'WAITING' || room.status === 'READY') && (
              <div className="card space-y-3 p-5">
                <Button className="w-full" size="lg" variant={mine.isReady ? 'secondary' : 'primary'} icon={<Check className="size-4" />} loading={busy} onClick={() => run(() => setReady(!mine.isReady))}>
                  {mine.isReady ? 'Not ready' : "I'm ready"}
                </Button>
                {isHost && (
                  <Button className="w-full" variant="gold" disabled={room.status !== 'READY'} onClick={() => run(start)}>
                    Start game
                  </Button>
                )}
                <p className="text-xs text-subtle">
                  {room.status === 'READY' ? 'Everyone is ready — the host can start now.' : `Needs at least ${room.minPlayers} players, all ready. A full room starts automatically.`}
                </p>
                <Button className="w-full" variant="ghost" icon={<DoorOpen className="size-4" />} onClick={doLeave}>
                  Leave room {room.entryFee > 0 && '(refund entry)'}
                </Button>
              </div>
            )}
            {!room.isPractice && room.status !== 'CANCELLED' && (
              <div className="card space-y-3 p-5">
                <h3 className="font-display font-semibold">Invite players</h3>
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(shareUrl)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-line-2 bg-surface px-3 py-2 text-left text-xs"
                >
                  <span className="truncate font-mono">{shareUrl}</span>
                  {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                </button>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (inviteName) run(() => invite(inviteName), () => {
                      useUi.getState().toast({ kind: 'success', title: `Invite sent to ${inviteName}` })
                      setInviteName('')
                    })
                  }}
                >
                  <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Username" className={`${inputClass} h-10`} aria-label="Username to invite" />
                  <Button type="submit" variant="secondary" icon={<Send className="size-4" />}>Invite</Button>
                </form>
                <p className="text-xs text-subtle">Room code: <span className="font-mono text-fg">{room.code}</span></p>
              </div>
            )}
          </aside>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6">
          <section className="min-w-0">
            {game && room.status === 'IN_PROGRESS' && (
              <PlayerStrip seats={room.seats} currentSeat={game.currentSeat} deadline={game.turnDeadline} offset={clockOffset} mySeat={mySeat} />
            )}
            {game && Board ? (
              <Board view={game} seats={room.seats} mySeat={mySeat} isMyTurn={room.status === 'IN_PROGRESS' && game.currentSeat !== null && game.currentSeat === mySeat} sendMove={sendMove} />
            ) : (
              <Spinner label="Loading game" />
            )}
          </section>
          <aside className="space-y-3">
            <div className="hidden space-y-3 lg:block">
              {room.seats.map((s) => (
                <SeatCard key={s.seat} seat={s} room={room} offset={clockOffset} current={room.status === 'IN_PROGRESS' && game?.currentSeat === s.seat} deadline={game?.currentSeat === s.seat ? game?.turnDeadline : null} />
              ))}
            </div>
            {room.status === 'IN_PROGRESS' && mine && mine.status !== 'FORFEITED' && (
              <Button variant="ghost" className="w-full text-danger" icon={<DoorOpen className="size-4" />} onClick={() => run(leave, () => navigate('/lobby'))}>
                Forfeit & leave
              </Button>
            )}
            {room.status === 'COMPLETED' && (
              <Button className="w-full" onClick={() => setShowResult(true)} icon={<Trophy className="size-4" />}>View result</Button>
            )}
            <p className="hidden px-1 text-[11px] text-subtle lg:block">Every move is validated on the server. Turns auto-play after the timer; disconnected players have a grace period to reconnect.</p>
          </aside>
        </div>
      )}

      <Modal open={showResult} onClose={() => setShowResult(false)} title="Match result">
        {room.result && (
          <div className="space-y-5 text-center">
            <motion.div initial={{ scale: 0.6, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} className="text-7xl">
              {room.result.outcome === 'DRAW' ? '🤝' : winnerSeat === mySeat ? '🏆' : '🎮'}
            </motion.div>
            <p className="font-display text-3xl font-bold">
              {room.result.outcome === 'DRAW' ? "It's a draw" : winnerSeat === mySeat ? 'You won!' : `${room.seats[winnerSeat ?? 0]?.displayName} wins`}
            </p>
            {room.result.outcome === 'FORFEIT' && <p className="text-sm text-muted">Won by forfeit.</p>}
            {!room.isPractice && (
              <div className="rounded-2xl bg-surface p-4">
                <p className="text-xs text-subtle uppercase">Net change to your wallet</p>
                <p className={`font-display text-4xl font-bold ${net > 0 ? 'text-success' : net < 0 ? 'text-danger' : 'text-muted'}`}>
                  {net > 0 ? '+' : net < 0 ? '−' : '±'}
                  {Math.abs(net)} <span className="text-base font-medium text-subtle">VC</span>
                </p>
                <p className="mt-2 text-xs text-subtle">
                  Entry −{myEntry} VC · {room.result.outcome === 'DRAW' ? 'pool split, stake returned' : 'prize'} +{myPayout} VC · pool {room.result.prizePool} VC
                </p>
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => navigate(`/games/${room.gameKey}`)}>Play again</Button>
              <Button variant="secondary" onClick={() => navigate('/lobby')}>Back to lobby</Button>
              <Button variant="ghost" onClick={() => navigate(`/history?game=${room.id}`)}>Match details</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
