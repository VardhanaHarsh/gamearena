import { useQuery } from '@tanstack/react-query'
import { Settings } from 'lucide-react'
import { motion } from 'motion/react'
import { Link, useParams } from 'react-router'
import { Avatar, Badge, Credits, EmptyState, Spinner, StatCard } from '../components/ui'
import { dateTime, pct } from '../lib/format'
import { api } from '../services/api'
import { useAuth } from '../store/auth'
import type { Level } from '../types/api'
import { GameIcon } from '../components/GameIcon'

interface PublicProfile {
  id: string
  username: string
  displayName: string
  avatar: string
  memberSince: string
  level: Level
  stats: { gamesPlayed: number; wins: number; losses: number; winRate: number; creditsWon: number; favoriteGame: string | null; leaderboardRank: number | null; perGame: { game_key: string; games_played: number; wins: number }[] }
  recent: { room_id: string; game_key: string; outcome: string; won: boolean; settled_at: string }[]
}

function WinRateRing({ rate }: { rate: number }) {
  const c = 2 * Math.PI * 42
  return (
    <svg viewBox="0 0 100 100" className="size-32" role="img" aria-label={`Win rate ${pct(rate)}`}>
      <circle cx="50" cy="50" r="42" fill="none" stroke="var(--surface-2)" strokeWidth="10" />
      <motion.circle cx="50" cy="50" r="42" fill="none" stroke="url(#wr)" strokeWidth="10" strokeLinecap="round" transform="rotate(-90 50 50)" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - rate) }} transition={{ duration: 1.2 }} />
      <defs><linearGradient id="wr"><stop offset="0" stopColor="var(--primary-2)" /><stop offset="1" stopColor="var(--cyan)" /></linearGradient></defs>
      <text x="50" y="55" textAnchor="middle" fontSize="18" fontWeight="700" fill="currentColor">{pct(rate)}</text>
    </svg>
  )
}

export function Profile() {
  const { username } = useParams()
  const me = useAuth((s) => s.user)
  const target = username ?? me?.username ?? ''
  const { data, isLoading, error } = useQuery({ queryKey: ['profile', target], queryFn: () => api<{ profile: PublicProfile }>(`/users/${target}`), enabled: !!target })
  if (isLoading) return <Spinner />
  if (error || !data) return <EmptyState icon="👤" title="Player not found" />
  const p = data.profile
  const own = p.id === me?.id
  const maxGames = Math.max(1, ...p.stats.perGame.map((g) => g.games_played))
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <section className="relative mb-8 overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-primary/20 via-transparent to-cyan/10 p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-5">
          <Avatar avatar={p.avatar} size={88} ring="var(--primary-2)" />
          <div className="mr-auto">
            <h1 className="font-display text-3xl font-bold">{p.displayName}</h1>
            <p className="text-sm text-muted">@{p.username} · member since {dateTime(p.memberSince).split(',')[0]}</p>
            <div className="mt-3 flex items-center gap-3">
              <Badge tone="primary">Level {p.level.level}</Badge>
              <div className="h-2 w-40 rounded-full bg-surface-2"><motion.div className="h-2 rounded-full bg-gradient-to-r from-primary to-cyan" initial={{ width: 0 }} animate={{ width: pct(p.level.progress) }} /></div>
              <span className="text-xs text-subtle">{p.level.xp}/{p.level.nextLevelXp} XP</span>
            </div>
          </div>
          {own && <Link to="/account" className="inline-flex items-center gap-2 rounded-xl border border-line-2 px-4 py-2 text-sm"><Settings className="size-4" />Edit profile</Link>}
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <div className="card flex flex-col items-center justify-center p-6">
          <WinRateRing rate={p.stats.winRate} />
          <p className="mt-2 text-sm text-muted">Win rate</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Games played" value={p.stats.gamesPlayed} />
          <StatCard label="Wins" value={p.stats.wins} />
          <StatCard label="Losses" value={p.stats.losses} />
          <StatCard label="Leaderboard rank" value={p.stats.leaderboardRank ? `#${p.stats.leaderboardRank}` : '—'} />
          <StatCard label="Favorite game" value={p.stats.favoriteGame ? <span className="flex items-center gap-2"><GameIcon game={p.stats.favoriteGame} size={30} />{p.stats.favoriteGame}</span> : '—'} />
          <StatCard label="Credits won" value={<Credits amount={Number(p.stats.creditsWon)} />} />
        </div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="mb-4 font-display text-lg font-semibold">Games by type</h2>
          <ul className="space-y-3">
            {p.stats.perGame.map((g) => (
              <li key={g.game_key}>
                <div className="mb-1 flex justify-between text-sm"><span className="flex items-center gap-2"><GameIcon game={g.game_key} size={22} />{g.game_key}</span><span className="text-muted">{g.wins}W / {g.games_played}G</span></div>
                <div className="relative h-2.5 rounded-full bg-surface-2">
                  <div className="absolute h-2.5 rounded-full bg-primary/40" style={{ width: `${(g.games_played / maxGames) * 100}%` }} />
                  <div className="absolute h-2.5 rounded-full bg-success" style={{ width: `${(g.wins / maxGames) * 100}%` }} />
                </div>
              </li>
            ))}
            {!p.stats.perGame.length && <li className="text-sm text-subtle">No ranked games yet.</li>}
          </ul>
        </section>
        <section className="card p-6">
          <h2 className="mb-4 font-display text-lg font-semibold">Recent results</h2>
          <ul className="flex flex-wrap gap-2">
            {p.recent.map((r) => (
              <li key={r.room_id} title={`${r.game_key} · ${dateTime(r.settled_at)}`} className={`flex size-10 items-center justify-center rounded-xl text-lg ${r.won ? 'bg-success/20' : r.outcome === 'DRAW' ? 'bg-surface-2' : 'bg-danger/15'}`}>
                <GameIcon game={r.game_key} size={26} />
              </li>
            ))}
            {!p.recent.length && <li className="text-sm text-subtle">No games yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  )
}
