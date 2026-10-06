import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Gift, Lock, RotateCcw, Trophy } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Badge, Button, Credits, PageHeader, Spinner, StatCard } from '../components/ui'
import { dateTime } from '../lib/format'
import { api } from '../services/api'
import type { LedgerTx, WalletSummary } from '../types/api'

const TYPE_META: Record<LedgerTx['transaction_type'], { label: string; icon: typeof Gift }> = {
  SIGNUP_BONUS: { label: 'Welcome grant', icon: Gift },
  ENTRY_FEE: { label: 'Entry fee', icon: Lock },
  PRIZE: { label: 'Prize', icon: Trophy },
  REFUND: { label: 'Refund', icon: RotateCcw },
}
const KIND_TEXT: Record<LedgerTx['entry_kind'], string> = {
  CREDIT: 'Credited to available',
  HOLD: 'Reserved (locked) for a game',
  CAPTURE: 'Locked credits moved to prize pool',
  RELEASE: 'Locked credits returned',
}

export function Wallet() {
  const [type, setType] = useState<string>('')
  const { data, isLoading } = useQuery({ queryKey: ['wallet'], queryFn: () => api<{ wallet: WalletSummary }>('/wallet') })
  const txs = useInfiniteQuery({
    queryKey: ['wallet', 'transactions', type],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<{ items: LedgerTx[]; nextCursor: string | null }>(`/wallet/transactions?limit=20${type ? `&type=${type}` : ''}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  if (isLoading || !data) return <Spinner />
  const w = data.wallet
  const items = txs.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader eyebrow="Wallet" title="Virtual credits" description="Credits are earned through the one-time welcome grant and game prizes. They can't be purchased, sold, transferred or withdrawn." />

      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative mb-6 overflow-hidden rounded-3xl border border-gold/30 bg-gradient-to-br from-amber-500/15 via-primary/10 to-cyan/10 p-6 sm:p-8">
        <p className="mb-3 inline-block rounded-md bg-amber-400 px-2 py-0.5 text-[11px] font-bold tracking-wide text-black">VIRTUAL CREDITS — NO REAL VALUE</p>
        <p className="text-sm text-muted">Available</p>
        <Credits amount={w.available} size="lg" />
        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          <span className="text-muted">Locked in games: <Credits amount={w.locked} size="sm" /></span>
          <span className="text-muted">Lifetime winnings: <Credits amount={w.winnings} size="sm" /></span>
        </div>
        <span className="pointer-events-none absolute -right-4 -bottom-8 text-[9rem] opacity-15" aria-hidden>🪙</span>
      </motion.section>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Welcome grant" value={<Credits amount={w.signupBonus} />} hint="One-time, on sign-up" />
        <StatCard label="Winnings" value={<Credits amount={w.winnings} />} />
        <StatCard label="Total games" value={w.total_games} hint="Excludes practice" />
        <StatCard label="Total wins" value={w.total_wins} />
      </div>

      <section className="card p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">Ledger</h2>
          <div className="flex flex-wrap gap-1.5">
            {['', 'SIGNUP_BONUS', 'ENTRY_FEE', 'PRIZE', 'REFUND'].map((t) => (
              <button key={t} onClick={() => setType(t)} aria-pressed={type === t} className={`rounded-full px-3 py-1 text-xs ${type === t ? 'bg-primary text-white' : 'border border-line-2 text-muted'}`}>
                {t ? TYPE_META[t as LedgerTx['transaction_type']].label : 'All'}
              </button>
            ))}
          </div>
        </div>
        <p className="mb-4 text-xs text-subtle">
          Append-only ledger: every balance change is a line here. Entry fees are first <em>held</em> (locked), then <em>captured</em> into the prize pool at settlement, or <em>released</em> if you leave before the game starts.
        </p>
        <ul className="divide-y divide-line">
          {items.map((tx) => {
            const meta = TYPE_META[tx.transaction_type]
            const delta = tx.available_delta
            return (
              <li key={tx.transaction_id} className="flex items-center gap-3 py-3">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${delta > 0 ? 'bg-success/15 text-success' : delta < 0 ? 'bg-danger/10 text-danger' : 'bg-surface-2 text-muted'}`}>
                  <meta.icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {meta.label}
                    <Badge tone={tx.status === 'COMPLETED' ? 'success' : tx.status === 'PENDING' ? 'warn' : 'default'}>{tx.status}</Badge>
                  </p>
                  <p className="truncate text-xs text-subtle">{KIND_TEXT[tx.entry_kind]}{tx.metadata.roomCode ? ` · room ${tx.metadata.roomCode as string}` : ''} · {dateTime(tx.created_at)}</p>
                </div>
                <div className="text-right">
                  <p className={`flex items-center justify-end gap-1 font-display font-semibold ${delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-muted'}`}>
                    {delta > 0 ? <ArrowDownLeft className="size-4" /> : delta < 0 ? <ArrowUpRight className="size-4" /> : null}
                    {delta > 0 ? '+' : delta < 0 ? '−' : ''}
                    {delta === 0 ? tx.amount : Math.abs(delta)} VC
                  </p>
                  {tx.locked_delta !== 0 && <p className="text-[10px] text-subtle">locked {tx.locked_delta > 0 ? '+' : '−'}{Math.abs(tx.locked_delta)}</p>}
                </div>
              </li>
            )
          })}
        </ul>
        {txs.isLoading && <Spinner />}
        {!txs.isLoading && !items.length && <p className="py-8 text-center text-sm text-subtle">No transactions yet.</p>}
        {txs.hasNextPage && (
          <Button variant="secondary" className="mt-4 w-full" loading={txs.isFetchingNextPage} onClick={() => txs.fetchNextPage()}>
            Load more
          </Button>
        )}
      </section>
    </div>
  )
}
