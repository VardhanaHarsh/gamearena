import type { BaseState, GameEngine, GameMeta } from './engine.js'
import { carromEngine } from './engines/carrom.engine.js'
import { connectFourEngine } from './engines/connectfour.engine.js'
import { ludoEngine } from './engines/ludo.engine.js'
import { ticTacToeEngine } from './engines/tictactoe.engine.js'

/**
 * Game registry — the single place a new game is plugged in.
 * Add an engine here and a row in the `games` table (see README "Adding a new game").
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const engines: Record<string, GameEngine<any, any>> = {
  [ludoEngine.meta.key]: ludoEngine,
  [carromEngine.meta.key]: carromEngine,
  [ticTacToeEngine.meta.key]: ticTacToeEngine,
  [connectFourEngine.meta.key]: connectFourEngine,
}

/** Games shown in the catalogue as "coming soon" — no engine yet. */
export const comingSoon: Pick<GameMeta, 'key' | 'name' | 'tagline'>[] = [
  { key: 'chess', name: 'Chess', tagline: 'The ultimate strategy duel.' },
  { key: 'checkers', name: 'Checkers', tagline: 'Jump, capture and crown your kings.' },
]

export const getEngine = (key: string): GameEngine<BaseState, unknown> | undefined => engines[key]
export const allEngines = () => Object.values(engines) as GameEngine<BaseState, unknown>[]
