import type { GameView, Seat } from '../types/api'

export interface BoardProps<S> {
  view: GameView<S>
  seats: Seat[]
  mySeat: number | null
  isMyTurn: boolean
  sendMove: (move: unknown) => Promise<void>
}

export const SEAT_COLORS = ['#ef4444', '#22c55e', '#eab308', '#3b82f6']
