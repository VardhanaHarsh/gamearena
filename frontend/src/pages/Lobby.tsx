import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Hash, Play, RefreshCw, Users, Zap } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Badge, Button, Credits, EmptyState, PageHeader, Spinner, inputClass, statusTone } from '../components/ui'
import { useRoomActions } from '../hooks/useRoomActions'
import { gameStyle } from '../lib/games'
import { api } from '../services/api'
import { getSocket } from '../services/socket'
import type { GameInfo, LobbyRoom } from '../types/api'

export function Lobby() {
  const [filter, setFilter] = useState<string>('all')
  const [code, setCode] = useState('')
  const qc = useQueryClient()
  const { join, quick } = useRoomActions()
  const { data: games } = useQuery({ queryKey: ['games'], queryFn: () => api<{ games: GameInfo[] }>('/games') })
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['rooms', filter],
    queryFn: () => api<{ rooms: LobbyRoom[] }>(`/rooms${filter === 'all' ? '' : `?gameKey=${filter}`}`),
    refetchInterval: 15_000,
  })
  const { data: active } = useQuery({ queryKey: ['rooms', 'active'], queryFn: () => api<{ room: { id: string; code: string; game_key: string; status: string } | null }>('/rooms/mine/active') })

  // Real-time lobby: the server pings `lobby:update` whenever rooms change.
  useEffect(() => {
    const socket = getSocket()
    socket.emit('lobby:subscribe')
    const onUpdate = () => {
      void qc.invalidateQueries({ queryKey: ['rooms'] })
      void qc.invalidateQueries({ queryKey: ['games'] })
    }
    socket.on('lobby:update', onUpdate)
    return () => {
      socket.off('lobby:update', onUpdate)
      socket.emit('lobby:unsubscribe')
    }
  }, [qc])

  const playable = games?.games.filter((g) => g.available) ?? []
  const nameOf = (k: string) => playable.find((g) => g.key === k)?.name ?? k

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Game lobby"
        title="Find your next match"
        description="Join an open room, quick-match into a game, or create your own. All amounts are virtual credits."
        actions={
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (code.trim()) join.mutate(code.trim())
            }}
          >
            <label className="relative">
              <Hash className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Room code" maxLength={8} className={`${inputClass} h-10 w-36 pl-8 font-mono uppercase`} aria-label="Join by room code" />
            </label>
            <Button type="submit" variant="secondary" loading={join.isPending}>
              Join
            </Button>
          </form>
        }
      />

      {active?.room && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary-2/40 bg-primary/10 px-4 py-3">
          <p className="text-sm">
            You're in <strong>{nameOf(active.room.game_key)}</strong> room <span className="font-mono">{active.room.code}</span> <Badge tone={statusTone(active.room.status)}>{active.room.status}</Badge>
          </p>
          <Link to={`/room/${active.room.id}`} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white">
            Return to room
          </Link>
        </motion.div>
      )}

      <section aria-label="Quick play" className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        {playable.map((g) => {
          const st = gameStyle(g.key)
          return (
            <div key={g.key} className="card relative overflow-hidden p-4">
              <div className="absolute -top-8 -right-8 size-24 rounded-full opacity-30 blur-2xl" style={{ background: st.to }} />
              <div className="flex items-start justify-between">
                <span className="text-3xl">{st.emoji}</span>
                <span className="flex items-center gap-1 text-[11px] text-success">
                  <span className="pulse-dot relative size-1.5 rounded-full bg-success text-success" />
                  {g.playersOnline ?? 0} online
                </span>
              </div>
              <p className="mt-2 font-display font-semibold">{g.name}</p>
              <p className="text-xs text-subtle">{g.openRooms ?? 0} open rooms</p>
              <Button size="sm" className="mt-3 w-full" icon={<Zap className="size-3.5" />} loading={quick.isPending && quick.variables?.gameKey === g.key} onClick={() => quick.mutate({ gameKey: g.key, entryFee: g.defaultEntry ?? 0 })}>
                Quick match · {g.defaultEntry} VC
              </Button>
            </div>
          )
        })}
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {['all', ...playable.map((g) => g.key)].map((k) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={`rounded-full px-4 py-1.5 text-sm transition ${filter === k ? 'bg-primary text-white' : 'border border-line-2 text-muted hover:text-fg'}`}>
            {k === 'all' ? 'All games' : nameOf(k)}
          </button>
        ))}
        <button onClick={() => refetch()} className="ml-auto rounded-lg p-2 text-muted hover:text-fg" aria-label="Refresh rooms">
          <RefreshCw className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {isLoading ? (
        <Spinner label="Loading rooms" />
      ) : !data?.rooms.length ? (
        <EmptyState icon="🕹️" title="No open rooms right now" body="Create a room or quick-match to start one — others will see it here instantly." action={<Link to="/games" className="text-sm text-primary-2 hover:underline">Browse games →</Link>} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {data.rooms.map((r) => {
              const st = gameStyle(r.game_key)
              const joinable = (r.status === 'WAITING' || r.status === 'READY') && r.players < r.max_players
              return (
                <motion.li key={r.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex size-11 items-center justify-center rounded-xl text-2xl" style={{ background: `linear-gradient(135deg, ${st.from}33, ${st.to}33)` }}>
                        {st.emoji}
                      </span>
                      <div>
                        <p className="font-display font-semibold">{nameOf(r.game_key)}</p>
                        <p className="font-mono text-[11px] text-subtle">#{r.code} · host {r.host_name}</p>
                      </div>
                    </div>
                    <Badge tone={statusTone(r.status)}>{r.status.replace('_', ' ')}</Badge>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-surface py-2">
                      <dt className="text-[10px] text-subtle uppercase">Players</dt>
                      <dd className="flex items-center justify-center gap-1 font-semibold">
                        <Users className="size-3.5 text-muted" />
                        {r.players}/{r.max_players}
                      </dd>
                    </div>
                    <div className="rounded-lg bg-surface py-2">
                      <dt className="text-[10px] text-subtle uppercase">Entry</dt>
                      <dd><Credits amount={r.entry_fee} size="sm" /></dd>
                    </div>
                    <div className="rounded-lg bg-surface py-2">
                      <dt className="text-[10px] text-subtle uppercase">Prize pool</dt>
                      <dd><Credits amount={r.prize_pool} size="sm" /></dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex gap-1" aria-hidden>
                    {Array.from({ length: r.max_players }, (_, i) => (
                      <span key={i} className={`h-1.5 flex-1 rounded-full ${i < r.players ? 'bg-gradient-to-r from-primary to-cyan' : 'bg-surface-2'}`} />
                    ))}
                  </div>
                  <Button className="mt-4 w-full" size="sm" variant={joinable ? 'primary' : 'secondary'} icon={<Play className="size-3.5" />} disabled={!joinable} loading={join.isPending && join.variables === r.id} onClick={() => join.mutate(r.id)}>
                    {joinable ? `Join · ${r.entry_fee} VC` : r.status === 'IN_PROGRESS' ? 'In progress' : 'Full'}
                  </Button>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  )
}
