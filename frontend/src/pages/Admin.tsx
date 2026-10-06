import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, CheckCircle2, Database, Gamepad2, Server, Users } from 'lucide-react'
import { useState } from 'react'
import { BarChart, HorizontalBars } from '../components/Charts'
import { Badge, Button, Credits, PageHeader, Spinner, StatCard, inputClass, statusTone } from '../components/ui'
import { dateTime, timeAgo } from '../lib/format'
import { api } from '../services/api'
import { useUi } from '../store/ui'
import type { RoomView } from '../types/api'

type Tab = 'overview' | 'users' | 'rooms' | 'transactions' | 'results' | 'flags' | 'logs'
type Row = Record<string, unknown>

const Table = ({ head, rows }: { head: string[]; rows: (string | number | React.ReactNode)[][] }) => (
  <div className="card overflow-x-auto">
    <table className="w-full min-w-[720px] text-left text-xs">
      <thead className="border-b border-line text-subtle uppercase"><tr>{head.map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-line">
        {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="p-3 align-top">{c}</td>)}</tr>)}
        {!rows.length && <tr><td colSpan={head.length} className="p-6 text-center text-subtle">Nothing here.</td></tr>}
      </tbody>
    </table>
  </div>
)

function Overview() {
  const { data: o } = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api<Row>('/admin/overview'), refetchInterval: 10_000 })
  const { data: c } = useQuery({ queryKey: ['admin', 'charts'], queryFn: () => api<{ gamesPerDay: { day: string; value: number }[]; playersPerDay: { day: string; value: number }[]; gamePopularity: { label: string; value: number }[]; creditsVolume: { day: string; value: number }[] }>('/admin/charts') })
  const { data: h } = useQuery({ queryKey: ['admin', 'health'], queryFn: () => api<Row & { postgres: Row; redis: Row }>('/admin/health'), refetchInterval: 15_000 })
  const { data: rec } = useQuery({ queryKey: ['admin', 'reconcile'], queryFn: () => api<{ walletsChecked: number; mismatches: unknown[] }>('/admin/reconciliation') })
  if (!o || !c) return <Spinner />
  const toBars = (d: { day: string; value: number }[]) => d.map((x) => ({ label: x.day, value: Number(x.value) }))
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={<Users className="size-3.5" />} label="Active players (5m)" value={String(o.active_players)} hint={`${o.total_users} registered`} />
        <StatCard icon={<Gamepad2 className="size-3.5" />} label="Games running" value={String(o.games_running)} hint={`${o.open_rooms} rooms waiting`} />
        <StatCard icon={<CheckCircle2 className="size-3.5" />} label="Games completed" value={String(o.games_completed)} />
        <StatCard icon={<Database className="size-3.5" />} label="Ledger transactions" value={String(o.ledger_transactions)} hint={`${o.failed_transactions} failed`} />
        <StatCard icon={<AlertTriangle className="size-3.5" />} label="Anti-cheat flags (24h)" value={String(o.flags_24h)} />
        <StatCard icon={<AlertTriangle className="size-3.5" />} label="Failed settlements (24h)" value={String(o.failed_settlements)} />
        <StatCard label="Credits in circulation" value={<Credits amount={Number(o.credits_in_circulation)} size="sm" />} hint="Virtual" />
        <StatCard icon={<Server className="size-3.5" />} label="System health" value={<Badge tone={h?.status === 'healthy' ? 'success' : 'danger'}>{String(h?.status ?? '…')}</Badge>} hint={h ? `PG ${String(h.postgres.latencyMs)}ms · Redis ${String(h.redis.latencyMs)}ms · up ${Math.round(Number(h.uptimeSeconds) / 60)}m` : ''} />
      </div>
      <div className={`rounded-xl border px-4 py-3 text-sm ${rec?.mismatches.length ? 'border-danger/40 bg-danger/10 text-danger' : 'border-success/40 bg-success/10 text-success'}`}>
        Ledger reconciliation: {rec ? `${rec.walletsChecked} wallets checked — ${rec.mismatches.length ? `${rec.mismatches.length} MISMATCHES` : 'every wallet equals the sum of its ledger lines ✓'}` : 'checking…'}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5"><h3 className="mb-4 font-display font-semibold">Games per day</h3><BarChart label="Games per day" data={toBars(c.gamesPerDay)} /></div>
        <div className="card p-5"><h3 className="mb-4 font-display font-semibold">Players per day</h3><BarChart label="Players per day" data={toBars(c.playersPerDay)} color="var(--cyan)" /></div>
        <div className="card p-5"><h3 className="mb-4 font-display font-semibold">Game popularity</h3><HorizontalBars data={c.gamePopularity} /></div>
        <div className="card p-5"><h3 className="mb-4 font-display font-semibold">Virtual credits volume</h3><BarChart label="Credits volume" data={toBars(c.creditsVolume)} color="var(--gold)" /></div>
      </div>
    </div>
  )
}

function UsersTab() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const { data } = useQuery({ queryKey: ['admin', 'users', q], queryFn: () => api<{ users: Row[] }>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`) })
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api(`/admin/users/${id}/status`, { method: 'POST', body: { status, reason: status === 'SUSPENDED' ? 'Suspended from admin dashboard (simulation)' : 'Reactivated from admin dashboard' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
    onError: (e: Error) => useUi.getState().toast({ kind: 'error', title: e.message }),
  })
  return (
    <div className="space-y-3">
      <input className={`${inputClass} max-w-xs`} placeholder="Search username or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
      <Table
        head={['User', 'Email', 'Role', 'Status', 'Available', 'Locked', 'Flags', 'Joined', '']}
        rows={(data?.users ?? []).map((u) => [
          `${u.display_name} (@${u.username})`, String(u.email), String(u.role), <Badge key="s" tone={u.status === 'ACTIVE' ? 'success' : 'danger'}>{String(u.status)}</Badge>, String(u.available ?? 0), String(u.locked ?? 0), String(u.flags), timeAgo(String(u.created_at)),
          u.role === 'ADMIN' ? '' : <Button key="a" size="sm" variant={u.status === 'SUSPENDED' ? 'secondary' : 'danger'} onClick={() => setStatus.mutate({ id: String(u.id), status: u.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' })}>{u.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}</Button>,
        ])}
      />
    </div>
  )
}

function RoomsTab() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['admin', 'rooms'], queryFn: () => api<{ rooms: (RoomView & { seq: number; connected: number })[] }>('/admin/rooms/live'), refetchInterval: 5000 })
  const { data: games } = useQuery({ queryKey: ['admin', 'games'], queryFn: () => api<{ games: Row[] }>('/admin/games') })
  const cancel = useMutation({ mutationFn: (id: string) => api(`/admin/rooms/${id}/cancel`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'rooms'] }) })
  const toggle = useMutation({ mutationFn: (g: Row) => api(`/admin/games/${g.key}`, { method: 'PATCH', body: { enabled: !g.enabled } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'games'] }) })
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 font-display font-semibold">Live rooms (in this server process)</h3>
        <Table head={['Room', 'Game', 'Status', 'Players', 'Connected', 'Moves', 'Pool', '']} rows={(data?.rooms ?? []).map((r) => [`#${r.code}${r.isPractice ? ' (practice)' : ''}`, r.gameName, <Badge key="s" tone={statusTone(r.status)}>{r.status}</Badge>, `${r.seats.length}/${r.maxPlayers}`, String(r.connected), String(r.seq), `${r.prizePool} VC`, <Button key="a" size="sm" variant="danger" onClick={() => cancel.mutate(r.id)}>Cancel & refund</Button>])} />
      </section>
      <section>
        <h3 className="mb-2 font-display font-semibold">Game management</h3>
        <Table head={['Game', 'Players', 'Default entry', 'Rooms', 'Enabled', '']} rows={(games?.games ?? []).map((g) => [String(g.name), `${g.min_players}–${g.max_players}`, `${g.default_entry} VC`, String(g.rooms), g.enabled ? 'Yes' : 'No', <Button key="a" size="sm" variant="secondary" onClick={() => toggle.mutate(g)}>{g.enabled ? 'Disable' : 'Enable'}</Button>])} />
      </section>
    </div>
  )
}

function SimpleTab({ tab }: { tab: Exclude<Tab, 'overview' | 'users' | 'rooms'> }) {
  const path = { transactions: '/admin/transactions', results: '/admin/results', flags: '/admin/flags', logs: '/admin/logs' }[tab]
  const { data } = useQuery({ queryKey: ['admin', tab], queryFn: () => api<Record<string, Row[]>>(path), refetchInterval: 15_000 })
  const rows = data ? Object.values(data)[0] : []
  if (!data) return <Spinner />
  if (tab === 'transactions') return <Table head={['When', 'User', 'Type', 'Kind', 'Amount', 'Status', 'Idempotency key']} rows={rows.map((t) => [dateTime(String(t.created_at)), String(t.username), String(t.transaction_type), String(t.entry_kind), `${t.amount} VC`, <Badge key="s" tone={t.status === 'COMPLETED' ? 'success' : 'warn'}>{String(t.status)}</Badge>, <span key="k" className="font-mono text-[10px]">{String(t.idempotency_key)}</span>])} />
  if (tab === 'results') return <Table head={['Settled', 'Room', 'Game', 'Outcome', 'Winner', 'Pool', 'Moves']} rows={rows.map((r) => [dateTime(String(r.settled_at)), `#${r.code}`, String(r.game_key), String(r.outcome), String(r.winner_username ?? '—'), `${r.prize_pool} VC`, String(r.moves)])} />
  if (tab === 'flags') return <Table head={['When', 'Player', 'Reason', 'Severity', 'Details']} rows={rows.map((f) => [dateTime(String(f.created_at)), String(f.username), String(f.reason), <Badge key="s" tone={f.severity === 'HIGH' ? 'danger' : f.severity === 'MEDIUM' ? 'warn' : 'default'}>{String(f.severity)}</Badge>, <code key="d" className="text-[10px]">{JSON.stringify(f.details).slice(0, 90)}</code>])} />
  return <Table head={['When', 'Level', 'Action', 'Actor', 'Target', 'Details']} rows={rows.map((l) => [dateTime(String(l.created_at)), <Badge key="l" tone={l.level === 'ERROR' ? 'danger' : l.level === 'WARN' ? 'warn' : 'default'}>{String(l.level)}</Badge>, <span key="a" className="font-mono">{String(l.action)}</span>, String(l.actor ?? 'system'), `${l.target_type ?? ''} ${String(l.target_id ?? '').slice(0, 8)}`, <code key="d" className="text-[10px]">{JSON.stringify(l.details).slice(0, 80)}</code>])} />
}

export function Admin() {
  const [tab, setTab] = useState<Tab>('overview')
  const tabs: Tab[] = ['overview', 'users', 'rooms', 'transactions', 'results', 'flags', 'logs']
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <PageHeader eyebrow="Administration" title={<span className="flex items-center gap-3"><Activity className="size-8 text-primary-2" />Admin dashboard</span>} description="Monitoring, audit trails and moderation simulation." />
      <div className="mb-6 flex gap-1 overflow-x-auto pb-1" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`shrink-0 rounded-full px-4 py-1.5 text-sm capitalize ${tab === t ? 'bg-primary text-white' : 'border border-line-2 text-muted'}`}>{t}</button>
        ))}
      </div>
      {tab === 'overview' ? <Overview /> : tab === 'users' ? <UsersTab /> : tab === 'rooms' ? <RoomsTab /> : <SimpleTab tab={tab} />}
    </div>
  )
}
