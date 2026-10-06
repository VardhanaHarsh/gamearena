import { useState } from 'react'
import { useRoomActions } from '../hooks/useRoomActions'
import type { GameInfo } from '../types/api'
import { Modal } from './Modal'
import { Button, Credits, Field, inputClass } from './ui'

const FEES = [0, 20, 50, 100, 250, 500]

export function CreateRoomModal({ game, open, onClose }: { game: GameInfo; open: boolean; onClose: () => void }) {
  const { create } = useRoomActions()
  const [fee, setFee] = useState(game.defaultEntry ?? 50)
  const [players, setPlayers] = useState(game.maxPlayers ?? 2)
  const [isPrivate, setPrivate] = useState(false)
  const min = game.minPlayers ?? 2
  const max = game.maxPlayers ?? 2
  return (
    <Modal open={open} onClose={onClose} title={`Create ${game.name} room`}>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate({ gameKey: game.key, entryFee: fee, maxPlayers: players, isPrivate })
        }}
      >
        <Field label="Entry fee (virtual credits)">
          <div className="flex flex-wrap gap-2">
            {FEES.map((f) => (
              <button type="button" key={f} onClick={() => setFee(f)} aria-pressed={fee === f} className={`rounded-lg border px-3 py-1.5 text-sm ${fee === f ? 'border-primary-2 bg-primary/15 text-fg' : 'border-line-2 text-muted'}`}>
                {f === 0 ? 'Free' : `${f} VC`}
              </button>
            ))}
            <input type="number" min={0} max={5000} value={fee} onChange={(e) => setFee(Math.max(0, Math.min(5000, Number(e.target.value))))} className={`${inputClass} h-9 w-28`} aria-label="Custom entry fee" />
          </div>
        </Field>
        {max > min && (
          <Field label="Players">
            <div className="flex gap-2">
              {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
                <button type="button" key={n} onClick={() => setPlayers(n)} aria-pressed={players === n} className={`size-10 rounded-lg border text-sm font-semibold ${players === n ? 'border-primary-2 bg-primary/15' : 'border-line-2 text-muted'}`}>
                  {n}
                </button>
              ))}
            </div>
          </Field>
        )}
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          Private room (invite-only, hidden from lobby)
        </label>
        <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-3 text-sm">
          <span className="text-muted">Prize pool if full</span>
          <Credits amount={fee * players} />
        </div>
        <p className="text-xs text-subtle">Your entry fee is reserved (locked) now and refunded if you leave before the game starts.</p>
        {create.error && <p className="text-sm text-danger">{create.error.message}</p>}
        <Button type="submit" className="w-full" size="lg" loading={create.isPending}>
          Create room
        </Button>
      </form>
    </Modal>
  )
}
