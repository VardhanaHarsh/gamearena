import type { ComponentType } from 'react'
import { CarromBoard } from './carrom/CarromBoard'
import { ConnectFourBoard } from './connectFour/ConnectFourBoard'
import { LudoBoard } from './ludo/LudoBoard'
import { TicTacToeBoard } from './ticTacToe/TicTacToeBoard'
import type { BoardProps } from './types'

/** Client-side counterpart of the server's engine registry: game key → board renderer. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BOARDS: Record<string, ComponentType<BoardProps<any>>> = {
  ludo: LudoBoard,
  carrom: CarromBoard,
  tictactoe: TicTacToeBoard,
  connectfour: ConnectFourBoard,
}
