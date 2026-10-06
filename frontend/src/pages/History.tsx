import { useQuery } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { Modal } from '../components/Modal'
import { Badge, Credits, EmptyState, PageHeader, Spinner, statusTone } from '../components/ui'
import { dateTime } from '../lib/format'
import { gameStyle } from '../lib/games'
import { api } from '../services/api'

interface HistoryItem {
  room_id: string
  code: string
  game_key: string
  entry_fee: number
  is_practice: boolean
  status: string
  created_at: string
  ended_at: string | null
  result: 'WON' | 'LOST' | 'DRAW' | 'CANCELLED'
  my_prize: number
  players: { seat: number; name: string }[]
}

interface Detail {
  room: { code: string; game_key: string; entry_fee: number; status: string; started_at: string | null; ended_at: string | null; is_practice: boolean }
  players: { seat: number; display_name: string; username: string | null; status: string; is_bot: boolean }[]
  moves: { seq: number; seat: number; move: Record<string, unknown>; created_at: string }[]
  settlement: { id: string; outcome: string; winner_seat: number | null; prize_pool: number; settled_at: string } | null
  transactions: { transaction_id: string; amount: number; transaction_type: string; entry_kind: string; status: string; idempotency_key: string; created_at: string }[]
}

const describeMove = (m: Record<string, unknown>) => {
  const auto = m.auto ? ' (auto)' : ''
  switch (m.type) {
    case 'roll': return `rolled the dice${auto}`
    case 'move': return `moved token ${(m.token as number) + 1}${auto}`
    case 'place': return `placed at cell ${(m.cell as number) + 1}${auto}`
    case 'drop': return `dropped in column ${(m.col as number) + 1}${auto}`
    case 'shot': return `struck at ${Math.round((m.power as number) * 100)}% power${auto}`
    default: return JSON.stringify(m)
  }
}

function GameDetails({ roomId }: { roomId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['history', roomId], queryFn: () => api<Detail>(`/history/${roomId}`) })
  if (isLoading || !data) return <Spinner />
  const winner = data.players.find((p) => p.seat === data.settlement?.winner_seat)
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 font-display font-semibold">Players</h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.players.map((p) => (
            <li key={p.seat} className="flex items-center justify-between rounded-xl bg-surface px-3 py-2 text-sm">
              <span className="flex items-center gap-1.5">{p.is_bot && <Bot className="size-3.5 text-cyan" />}{p.display_name}</span>
              {p.seat === data.settlement?.winner_seat ? <Badge tone="success">Winner</Badge> : p.status === 'FORFEITED' ? <Badge tone="danger">Forfeited</Badge> : null}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 font-display font-semibold">Settlement</h3>
        {data.settlement ? (
          <dl className="grid grid-cols-2 gap-2 rounded-xl bg-surface p-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-subtle">Outcome</dt><dd>{data.settlement.outcome}</dd></div>
            <div><dt className="text-xs text-subtle">Winner</dt><dd>{winner?.display_name ?? '—'}</dd></div>
            <div><dt className="text-xs text-subtle">Prize pool</dt><dd><Credits amount={data.settlement.prize_pool} size="sm" /></dd></div>
            <div><dt className="text-xs text-subtle">Settled</dt><dd>{dateTime(data.settlement.settled_at)}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-subtle">Not settled (cancelled — entry fees refunded).</p>
        )}
      </section>
      <section>
        <h3 className="mb-2 font-display font-semibold">Your ledger lines</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-subtle"><tr><th className="py-1.5">Type</th><th>Kind</th><th>Amount</th><th>Status</th><th>Idempotency key</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.transactions.map((t) => (
                <tr key={t.transaction_id}><td className="py-1.5">{t.transaction_type}</td><td>{t.entry_kind}</td><td>{t.amount} VC</td><td>{t.status}</td><td className="font-mono text-[10px] text-subtle">{t.idempotency_key.slice(0, 32)}…</td></tr>
              ))}
              {!data.transactions.length && <tr><td colSpan={5} className="py-2 text-subtle">No credits moved (free / practice game).</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h3 className="mb-2 font-display font-semibold">Moves ({data.moves.length})</h3>
        <ol className="max-h-64 space-y-1 overflow-y-auto rounded-xl bg-surface p-3 font-mono text-xs">
          {data.moves.map((m) => (
            <li key={m.seq}><span className="text-subtle">#{m.seq}</span> {data.players.find((p) => p.seat === m.seat)?.display_name} {describeMove(m.move)}</li>
          ))}
          {!data.moves.length && <li className="text-subtle">No recorded moves (seeded demo game).</li>}
        </ol>
      </section>
    </div>
  )
}

export function History() {
  const [params, setParams] = useSearchParams()
  const selected = params.get('game')
  const { data, isLoading } = useQuery({ queryKey: ['history'], queryFn: () => api<{ items: HistoryItem[] }>('/history') })
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader eyebrow="History" title="Game history" description="Every finished game, with full move log, settlement and ledger lines." />
      {isLoading ? (
        <Spinner />
      ) : !data?.items.length ? (
        <EmptyState icon="📜" title="No games yet" body="Finished games will appear here." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-xs text-subtle uppercase">
              <tr><th className="p-4">Game</th><th>Date</th><th>Players</th><th>Result</th><th>Entry</th><th>Prize</th><th>Status</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((h) => (
                <tr key={h.room_id} onClick={() => setParams({ game: h.room_id })} className="cursor-pointer transition hover:bg-surface" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setParams({ game: h.room_id })}>
                  <td className="p-4 font-medium">{gameStyle(h.game_key).emoji} {h.game_key} {h.is_practice && <Badge tone="primary">practice</Badge>}</td>
                  <td className="text-muted">{dateTime(h.ended_at ?? h.created_at)}</td>
                  <td className="max-w-48 truncate text-muted">{h.players?.map((p) => p.name).join(', ')}</td>
                  <td><Badge tone={statusTone(h.result)}>{h.result}</Badge></td>
                  <td><Credits amount={h.entry_fee} size="sm" /></td>
                  <td><Credits amount={h.my_prize} size="sm" /></td>
                  <td className="text-xs text-muted">{h.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!selected} onClose={() => setParams({})} title="Game details" wide>
        {selected && <GameDetails roomId={selected} />}
      </Modal>
    </div>
  )
}
