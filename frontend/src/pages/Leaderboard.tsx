import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Avatar, Credits, EmptyState, PageHeader, Spinner } from '../components/ui'
import { pct } from '../lib/format'
import { api } from '../services/api'
import { useAuth } from '../store/auth'
import type { GameInfo, LeaderboardEntry } from '../types/api'

const MEDAL = ['🥇', '🥈', '🥉']

export function Leaderboard() {
  const me = useAuth((s) => s.user)
  const [period, setPeriod] = useState<'global' | 'weekly'>('global')
  const [game, setGame] = useState('')
  const { data: games } = useQuery({ queryKey: ['games'], queryFn: () => api<{ games: GameInfo[] }>('/games') })
  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', period, game],
    queryFn: () => api<{ entries: LeaderboardEntry[] }>(`/leaderboard?period=${period}${game ? `&game=${game}` : ''}`),
  })
  const top = data?.entries.slice(0, 3) ?? []
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader eyebrow="Rankings" title="Leaderboard" description="Ranked by wins, then virtual credits won. Practice games don't count." />
      <div className="mb-6 flex flex-wrap gap-2">
        {(['global', 'weekly'] as const).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} aria-pressed={period === p} className={`rounded-full px-4 py-1.5 text-sm capitalize ${period === p ? 'bg-primary text-white' : 'border border-line-2 text-muted'}`}>{p}</button>
        ))}
        <select value={game} onChange={(e) => setGame(e.target.value)} className="ml-auto h-9 rounded-full border border-line-2 bg-bg-2 px-3 text-sm" aria-label="Filter by game">
          <option value="">All games</option>
          {games?.games.filter((g) => g.available).map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
        </select>
      </div>

      {isLoading ? (
        <Spinner />
      ) : !data?.entries.length ? (
        <EmptyState icon="🏁" title="No ranked games yet" body="Play a game with an entry fee to get on the board." />
      ) : (
        <>
          <div className="mb-8 grid grid-cols-3 items-end gap-3">
            {[1, 0, 2].map((i) => {
              const e = top[i]
              if (!e) return <div key={i} />
              return (
                <motion.div key={e.user_id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className={`card flex flex-col items-center p-4 text-center ${i === 0 ? 'border-gold/50 pb-8' : ''}`}>
                  <span className="text-3xl">{MEDAL[i]}</span>
                  <Avatar avatar={e.avatar} size={i === 0 ? 64 : 48} />
                  <Link to={`/players/${e.username}`} className="mt-2 truncate font-display font-semibold hover:underline">{e.display_name}</Link>
                  <p className="text-xs text-muted">{e.wins} wins</p>
                </motion.div>
              )
            })}
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-line text-xs text-subtle uppercase">
                <tr><th className="p-4">Rank</th><th>Player</th><th>Games</th><th>Wins</th><th>Win rate</th><th>Credits won</th></tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {data.entries.map((e, i) => (
                    <motion.tr key={e.user_id} layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className={`border-b border-line ${e.user_id === me?.id ? 'bg-primary/10' : ''}`}>
                      <td className="p-4 font-display text-lg font-bold">{MEDAL[e.rank - 1] ?? `#${e.rank}`}</td>
                      <td><Link to={`/players/${e.username}`} className="flex items-center gap-2 hover:underline"><Avatar avatar={e.avatar} size={30} />{e.display_name}</Link></td>
                      <td>{e.games}</td>
                      <td>{e.wins}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 rounded-full bg-surface-2"><div className="h-1.5 rounded-full bg-success" style={{ width: pct(e.winRate) }} /></div>
                          {pct(e.winRate)}
                        </div>
                      </td>
                      <td><Credits amount={Number(e.credits_won)} size="sm" /></td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
