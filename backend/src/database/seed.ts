import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '../lib/logger.js'
import { register } from '../modules/auth/auth.service.js'
import * as rooms from '../modules/rooms/rooms.service.js'
import { settleGame } from '../modules/rooms/settlement.service.js'
import { redis } from '../redis/client.js'
import { migrate } from './migrate.js'
import { pool } from './pool.js'

const here = dirname(fileURLToPath(import.meta.url))
const SEED_FILE = process.env.SEED_FILE ?? resolve(here, '../../../database/seed/demo-data.json')

interface SeedData {
  password: string
  admin: { email: string; username: string; displayName: string; password: string }
  players: { email: string; username: string; displayName: string; avatar: string }[]
  completedGames: { game: string; fee: number; players: number[]; winner: number | null; daysAgo: number }[]
}

/**
 * Seeds demo data through the real services, so every credit movement is a genuine ledger line
 * (welcome grants, entry-fee holds, captures and prizes). Safe to re-run: exits if already seeded.
 */
export async function seed() {
  await migrate()
  const data = JSON.parse(await readFile(SEED_FILE, 'utf8')) as SeedData
  const { rows } = await pool.query('SELECT 1 FROM users WHERE username = $1', [data.players[0].username])
  if (rows[0]) {
    logger.info('seed data already present — skipping')
    return
  }

  const admin = await register({ ...data.admin, password: process.env.ADMIN_PASSWORD ?? data.admin.password })
  await pool.query(`UPDATE users SET role = 'ADMIN' WHERE id = $1`, [admin.id])

  const players: string[] = []
  for (const p of data.players) {
    const u = await register({ email: p.email, username: p.username, displayName: p.displayName, password: data.password })
    await pool.query('UPDATE user_profiles SET avatar = $2 WHERE user_id = $1', [u.id, p.avatar])
    players.push(u.id)
  }

  for (const g of data.completedGames) {
    const [host, ...others] = g.players.map((i) => players[i])
    const room = await rooms.createRoom(host, { gameKey: g.game, entryFee: g.fee, maxPlayers: g.players.length, isPrivate: false })
    for (const uid of others) await rooms.joinRoom(uid, room.id)
    await rooms.setStatus(room.id, 'IN_PROGRESS')
    const winnerSeat = g.winner === null ? null : g.players.indexOf(g.winner)
    await settleGame({ roomId: room.id, outcome: winnerSeat === null ? 'DRAW' : 'WIN', winnerSeat, finalState: { seeded: true } })
    const when = `now() - make_interval(days => ${g.daysAgo}) - interval '2 hours'`
    await pool.query(`UPDATE game_rooms SET created_at = ${when}, started_at = ${when}, ended_at = ${when} + interval '15 minutes' WHERE id = $1`, [room.id])
    await pool.query(`UPDATE game_results SET settled_at = ${when} + interval '15 minutes' WHERE room_id = $1`, [room.id])
    await pool.query(`UPDATE game_players SET joined_at = ${when} WHERE room_id = $1`, [room.id])
  }
  logger.info({ players: players.length, games: data.completedGames.length }, 'demo data seeded')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  seed()
    .catch((err) => {
      logger.error({ err }, 'seed failed')
      process.exitCode = 1
    })
    .finally(async () => {
      await pool.end()
      redis.disconnect()
    })
}
