import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { uuid } from '../lib/format'
import { emitAck, getSocket } from '../services/socket'
import { play } from '../services/sound'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'
import type { GameView, RoomView } from '../types/api'

/**
 * Subscribes to a room over Socket.IO. Joining the room channel is also the reconnect path:
 * on every (re)connect we re-emit `room:join` and the server replays the full room + game state.
 */
export function useRoom(roomId: string) {
  const me = useAuth((s) => s.user)
  const qc = useQueryClient()
  const [room, setRoom] = useState<RoomView | null>(null)
  const [game, setGame] = useState<GameView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clockOffset, setClockOffset] = useState(0)
  const lastSeq = useRef(-1)

  useEffect(() => {
    const socket = getSocket()
    let alive = true
    const subscribe = () =>
      emitAck<RoomView>('room:join', { roomId })
        .then(() => alive && setError(null))
        .catch((e: Error) => alive && setError(e.message))

    const onRoom = (r: RoomView) => r.id === roomId && setRoom(r)
    const onGame = (g: GameView | null) => {
      if (!g || g.roomId !== roomId) return
      setClockOffset(g.serverTime - Date.now())
      if (g.seq > lastSeq.current && lastSeq.current >= 0) {
        for (const ev of g.state.events ?? []) {
          if (ev.type === 'dice') play('dice')
          else if (ev.type === 'capture' || ev.type === 'foul') play('capture')
          else if (['move', 'castle', 'place', 'drop', 'pocket'].includes(ev.type)) play('move')
        }
      }
      lastSeq.current = g.seq
      setGame(g)
    }
    const onTurn = (t: { roomId: string; seat: number; deadline: number | null; serverTime: number }) => {
      if (t.roomId !== roomId) return
      setClockOffset(t.serverTime - Date.now())
      setGame((g) => (g ? { ...g, currentSeat: t.seat, turnDeadline: t.deadline } : g))
    }
    const onStart = () => play('start')
    const onEnd = (e: { winnerSeat: number | null; outcome: string; payouts: { userId: string }[] }) => {
      const won = e.payouts.some((p) => p.userId === me?.id) && e.outcome !== 'DRAW'
      play(won || e.outcome === 'DRAW' ? 'win' : 'lose')
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['wallet'] })
    }
    const onDisconnect = (p: { seat: number }) => useUi.getState().toast({ kind: 'info', title: 'Player disconnected', body: `Seat ${p.seat + 1} has a short grace period to reconnect.` })
    const onReconnect = () => useUi.getState().toast({ kind: 'success', title: 'Player reconnected' })

    socket.on('connect', subscribe)
    socket.on('room:state', onRoom)
    socket.on('game:state', onGame)
    socket.on('game:turn', onTurn)
    socket.on('game:start', onStart)
    socket.on('game:end', onEnd)
    socket.on('player:disconnect', onDisconnect)
    socket.on('player:reconnect', onReconnect)
    if (socket.connected) void subscribe()
    return () => {
      alive = false
      socket.off('connect', subscribe)
      socket.off('room:state', onRoom)
      socket.off('game:state', onGame)
      socket.off('game:turn', onTurn)
      socket.off('game:start', onStart)
      socket.off('game:end', onEnd)
      socket.off('player:disconnect', onDisconnect)
      socket.off('player:reconnect', onReconnect)
    }
  }, [roomId, me?.id, qc])

  const mySeat = room?.seats.find((s) => s.userId === me?.id)?.seat ?? null

  const sendMove = useCallback(
    async (move: unknown) => {
      try {
        await emitAck('game:move', { roomId, move, clientMoveId: uuid(), clientTs: Date.now() })
      } catch (e) {
        play('error')
        useUi.getState().toast({ kind: 'error', title: (e as Error).message || 'Invalid move.' })
        throw e
      }
    },
    [roomId],
  )

  return { room, game, error, mySeat, clockOffset, sendMove, setReady: (ready: boolean) => emitAck<RoomView>('room:ready', { roomId, ready }), start: () => emitAck('room:start', { roomId }), leave: () => emitAck('room:leave', { roomId }), invite: (username: string) => emitAck('room:invite', { roomId, username }) }
}
