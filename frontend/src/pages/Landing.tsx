import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Coins, ShieldCheck, Users, Zap } from 'lucide-react'
import { motion } from 'motion/react'
import { Link } from 'react-router'
import { Particles } from '../components/Particles'
import { gameStyle } from '../lib/games'
import { api } from '../services/api'
import { useAuth } from '../store/auth'
import type { GameInfo } from '../types/api'

const FALLBACK: GameInfo[] = [
  { key: 'ludo', name: 'Ludo', tagline: 'The classic race home.', available: true },
  { key: 'carrom', name: 'Carrom', tagline: 'Physics-driven flicks.', available: true },
  { key: 'chess', name: 'Chess', tagline: 'The ultimate strategy duel.', available: false },
  { key: 'tictactoe', name: 'Tic-Tac-Toe', tagline: 'Three in a row.', available: true },
  { key: 'checkers', name: 'Checkers', tagline: 'Jump and crown.', available: false },
  { key: 'connectfour', name: 'Connect Four', tagline: 'Drop and connect.', available: true },
]

const features = [
  { icon: Zap, title: 'Real-time multiplayer', body: 'Socket.IO rooms with server-authoritative game state, turn timers and reconnects.' },
  { icon: ShieldCheck, title: 'Fair by design', body: 'The server rolls every die and validates every move. Clients only send intents.' },
  { icon: Coins, title: 'Virtual credits only', body: 'Every player starts with 1,000 virtual credits. No real money, ever.' },
  { icon: Users, title: 'Compete & climb', body: 'Global, weekly and per-game leaderboards with full match history.' },
]

export function Landing() {
  const signedIn = useAuth((s) => !!s.user)
  const { data } = useQuery({ queryKey: ['games'], queryFn: () => api<{ games: GameInfo[] }>('/games', { auth: false }) })
  const games = data?.games ?? FALLBACK

  return (
    <div>
      <section className="relative overflow-hidden">
        <Particles />
        <div className="relative mx-auto max-w-7xl px-4 pt-16 pb-20 text-center sm:px-6 sm:pt-24 sm:pb-28">
          <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-line-2 bg-surface px-3 py-1 font-mono text-xs text-muted">
            <span className="pulse-dot relative size-2 rounded-full bg-success text-success" />
            Live multiplayer arena · Virtual credits
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="font-display text-5xl leading-none font-bold tracking-tight sm:text-7xl lg:text-8xl"
          >
            PLAY. COMPETE. <span className="text-gradient">WIN.</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="mx-auto mt-6 max-w-xl text-lg text-muted sm:text-xl">
            Your multiplayer gaming arena.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mt-10 flex flex-wrap justify-center gap-3">
            <Link to={signedIn ? '/lobby' : '/register'} className="group inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary-2 px-7 font-display text-lg font-semibold text-white shadow-[0_10px_40px_-10px_var(--primary)] transition hover:brightness-110">
              PLAY NOW <ArrowRight className="size-5 transition group-hover:translate-x-1" />
            </Link>
            <a href="#games" className="inline-flex h-12 items-center rounded-xl border border-line-2 bg-surface px-7 font-display text-lg font-semibold transition hover:border-primary-2">
              EXPLORE GAMES
            </a>
          </motion.div>
          <p className="mt-5 text-xs text-subtle">New players receive 🪙 1,000 virtual credits. Credits have no monetary value and can't be purchased or withdrawn.</p>
        </div>
      </section>

      <section id="games" className="mx-auto max-w-7xl scroll-mt-28 px-4 pb-20 sm:px-6">
        <h2 className="mb-8 text-center font-display text-3xl font-bold">Choose your game</h2>
        <ul className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3">
          {games.map((g, i) => {
            const st = gameStyle(g.key)
            return (
              <motion.li key={g.key} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }}>
                <Link
                  to={g.available ? `/games/${g.key}` : '#games'}
                  aria-disabled={!g.available}
                  className="group card relative block h-full overflow-hidden p-4 transition duration-300 hover:-translate-y-1 hover:border-primary-2/50 sm:p-6"
                >
                  <div className="absolute -top-10 -right-10 size-36 rounded-full opacity-30 blur-2xl transition group-hover:opacity-60" style={{ background: `linear-gradient(135deg, ${st.from}, ${st.to})` }} />
                  <span className="relative text-4xl sm:text-5xl" aria-hidden>
                    {st.emoji}
                  </span>
                  <h3 className="relative mt-4 font-display text-lg font-bold sm:text-2xl">{g.name}</h3>
                  <p className="relative mt-1 text-xs text-muted sm:text-sm">{g.tagline}</p>
                  <span className={`relative mt-4 inline-block rounded-full px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase ${g.available ? 'bg-success/15 text-success' : 'bg-surface-2 text-subtle'}`}>
                    {g.available ? 'Play now' : 'Coming soon'}
                  </span>
                </Link>
              </motion.li>
            )
          })}
        </ul>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <li key={f.title} className="card p-5">
              <f.icon className="size-6 text-primary-2" />
              <h3 className="mt-3 font-display text-lg font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted">{f.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
