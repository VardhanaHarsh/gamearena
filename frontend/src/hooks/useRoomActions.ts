import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api } from '../services/api'
import { play } from '../services/sound'
import { useUi } from '../store/ui'
import type { GameView, RoomView } from '../types/api'

type RoomResponse = { room: RoomView; game: GameView | null }

/** REST actions that move credits (create/join) — the server holds the entry fee atomically. */
export function useRoomActions() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const onSuccess = (res: RoomResponse) => {
    play('start')
    void qc.invalidateQueries({ queryKey: ['me'] })
    void qc.invalidateQueries({ queryKey: ['rooms'] })
    navigate(`/room/${res.room.id}`)
  }
  const onError = (e: Error) => {
    play('error')
    useUi.getState().toast({ kind: 'error', title: 'Unable to join game.', body: e.message })
  }
  return {
    create: useMutation({ mutationFn: (body: { gameKey: string; entryFee: number; maxPlayers: number; isPrivate: boolean }) => api<RoomResponse>('/rooms', { method: 'POST', body }), onSuccess, onError }),
    join: useMutation({ mutationFn: (idOrCode: string) => api<RoomResponse>(`/rooms/${encodeURIComponent(idOrCode)}/join`, { method: 'POST' }), onSuccess, onError }),
    quick: useMutation({ mutationFn: (body: { gameKey: string; entryFee: number }) => api<RoomResponse>('/rooms/quick-match', { method: 'POST', body }), onSuccess, onError }),
    practice: useMutation({ mutationFn: (body: { gameKey: string; players: number }) => api<RoomResponse>('/rooms/practice', { method: 'POST', body }), onSuccess, onError }),
  }
}
