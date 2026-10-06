import { Router } from 'express'
import { pool } from '../../database/pool.js'
import { Errors } from '../../lib/errors.js'
import { allEngines, comingSoon, getEngine } from './registry.js'
import { gameServer } from '../../websocket/gameServer.js'

export const gamesRouter = Router()

async function catalogue() {
  const { rows } = await pool.query<{ key: string; default_entry: number; enabled: boolean }>('SELECT key, default_entry, enabled FROM games')
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const live = gameServer.liveCounts()
  return [
    ...allEngines()
      .filter((e) => byKey.get(e.meta.key)?.enabled !== false)
      .map((e) => ({
        ...e.meta,
        available: true,
        defaultEntry: byKey.get(e.meta.key)?.default_entry ?? 0,
        playersOnline: live.playersByGame[e.meta.key] ?? 0,
        openRooms: live.openRoomsByGame[e.meta.key] ?? 0,
      })),
    ...comingSoon.map((g) => ({ ...g, available: false })),
  ]
}

gamesRouter.get('/', async (_req, res) => {
  res.json({ games: await catalogue(), currency: 'VIRTUAL_CREDITS' })
})

gamesRouter.get('/:key', async (req, res) => {
  const engine = getEngine(String(req.params.key))
  if (!engine) throw Errors.notFound('Game')
  const game = (await catalogue()).find((g) => g.key === engine.meta.key)
  res.json({ game })
})
