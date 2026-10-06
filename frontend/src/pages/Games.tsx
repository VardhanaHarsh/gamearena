import { useQuery } from '@tanstack/react-query'
import { Clock, Dumbbell, Plus, Trophy, Users, Zap } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { CreateRoomModal } from '../components/CreateRoomModal'
import { Badge, Button, Credits, EmptyState, PageHeader, Spinner, StatCard } from '../components/ui'
import { useRoomActions } from '../hooks/useRoomActions'
import { gameStyle } from '../lib/games'
import { api } from '../services/api'
import type { GameInfo, LobbyRoom } from '../types/api'
import { GameIcon } from '../components/GameIcon'

export function GamesList() {
  const { data, isLoading } = useQuery({ queryKey: ['games'], queryFn: () => api<{ games: GameInfo[] }>('/games') })
  if (isLoading) return <Spinner />
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader eyebrow="Catalogue" title="Games" description="Every game runs on the same modular, server-authoritative engine interface." />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.games.map((g, i) => {
          return (
            <motion.li key={g.key} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Link to={g.available ? `/games/${g.key}` : '#'} className={`card group block h-full p-5 transition hover:-translate-y-0.5 hover:border-primary-2/50 ${g.available ? '' : 'pointer-events-none opacity-60'}`}>
                <div className="flex items-center justify-between">
                  <GameIcon game={g.key} size={56} className="transition duration-300 group-hover:scale-110 group-hover:-rotate-6" />
                  {g.available ? <Badge tone="success">{g.playersOnline ?? 0} online</Badge> : <Badge>Coming soon</Badge>}
                </div>
                <h2 className="mt-4 font-display text-2xl font-bold">{g.name}</h2>
                <p className="mt-1 text-sm text-muted">{g.tagline}</p>
                {g.available && (
                  <p className="mt-4 flex flex-wrap gap-3 text-xs text-subtle">
                    <span className="flex items-center gap-1"><Users className="size-3.5" />{g.minPlayers}–{g.maxPlayers} players</span>
                    <span className="flex items-center gap-1"><Clock className="size-3.5" />~{g.estMinutes} min</span>
                  </p>
                )}
              </Link>
            </motion.li>
          )
        })}
      </ul>
    </div>
  )
}

export function GameDetail() {
  const { key = '' } = useParams()
  const [creating, setCreating] = useState(false)
  const { quick, practice, join } = useRoomActions()
  const { data, isLoading, error } = useQuery({ queryKey: ['game', key], queryFn: () => api<{ game: GameInfo }>(`/games/${key}`) })
  const { data: rooms } = useQuery({ queryKey: ['rooms', key], queryFn: () => api<{ rooms: LobbyRoom[] }>(`/rooms?gameKey=${key}`), refetchInterval: 10_000 })
  if (isLoading) return <Spinner />
  if (error || !data?.game) return <EmptyState icon="🤔" title="Game not found" />
  const g = data.game
  const st = gameStyle(g.key)
  const waiting = rooms?.rooms.filter((r) => r.status === 'WAITING' || r.status === 'READY') ?? []
  const playersWaiting = waiting.reduce((s, r) => s + r.players, 0)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="relative mb-8 overflow-hidden rounded-3xl border border-line p-6 sm:p-10" style={{ background: `linear-gradient(135deg, ${st.from}2a, ${st.to}22)` }}>
        <GameIcon game={g.key} size={220} className="pointer-events-none absolute -right-8 -bottom-12 opacity-25 rotate-12" />
        <PageHeader eyebrow="Game" title={<span className="flex items-center gap-3"><GameIcon game={g.key} size={52} />{g.name}</span>} description={g.tagline} />
        <div className="relative flex flex-wrap gap-2">
          <Button size="lg" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>CREATE ROOM</Button>
          <Button size="lg" variant="gold" icon={<Zap className="size-4" />} loading={quick.isPending} onClick={() => quick.mutate({ gameKey: g.key, entryFee: g.defaultEntry ?? 0 })}>
            JOIN GAME
          </Button>
          <Button size="lg" variant="secondary" icon={<Dumbbell className="size-4" />} loading={practice.isPending} onClick={() => practice.mutate({ gameKey: g.key, players: g.key === 'ludo' ? 4 : 2 })}>
            PRACTICE MODE
          </Button>
        </div>
        <p className="relative mt-3 text-xs text-muted">Join Game quick-matches you into an open {g.defaultEntry} VC room (or opens one). Practice is free, against server bots, and doesn't affect rankings.</p>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Players" value={`${g.minPlayers}–${g.maxPlayers}`} icon={<Users className="size-3.5" />} />
        <StatCard label="Default entry" value={<Credits amount={g.defaultEntry ?? 0} />} hint="Virtual credits" />
        <StatCard label="Est. duration" value={`~${g.estMinutes} min`} icon={<Clock className="size-3.5" />} />
        <StatCard label="Players waiting" value={playersWaiting} hint={`${waiting.length} open rooms`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="card p-6">
          <h2 className="mb-4 font-display text-xl font-semibold">Rules</h2>
          <ol className="space-y-3">
            {g.rules?.map((r, i) => (
              <li key={r} className="flex gap-3 text-sm text-muted">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-xs text-primary-2">{i + 1}</span>
                {r}
              </li>
            ))}
          </ol>
          <div className="mt-6 flex gap-3 rounded-xl bg-gold/10 p-4 text-sm">
            <Trophy className="size-5 shrink-0 text-gold" />
            <div>
              <p className="font-semibold text-gold">Prize structure</p>
              <p className="text-muted">{g.prizeStructure} Prize pool = entry fee × players, paid in virtual credits.</p>
            </div>
          </div>
        </section>
        <section className="card p-6">
          <h2 className="mb-4 font-display text-xl font-semibold">Open rooms</h2>
          {waiting.length ? (
            <ul className="space-y-2">
              {waiting.map((r) => (
                <li key={r.id} className="flex items-center justify-between rounded-xl bg-surface px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium">{r.host_name}'s room <span className="font-mono text-xs text-subtle">#{r.code}</span></p>
                    <p className="text-xs text-muted">{r.players}/{r.max_players} players · <Credits amount={r.entry_fee} size="sm" /></p>
                  </div>
                  <Button size="sm" loading={join.isPending && join.variables === r.id} onClick={() => join.mutate(r.id)}>Join</Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-subtle">No one is waiting yet — create a room!</p>
          )}
        </section>
      </div>
      {creating && <CreateRoomModal game={g} open={creating} onClose={() => setCreating(false)} />}
    </div>
  )
}
