import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../../database/pool.js'
import { Errors } from '../../lib/errors.js'
import { authenticate, currentUser } from '../../middleware/auth.js'
import { input, validate } from '../../middleware/validate.js'

export const historyRouter = Router()
historyRouter.use(authenticate)

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), includePractice: z.coerce.boolean().default(true) })

historyRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  const me = currentUser(req)
  const { limit, includePractice } = input<z.infer<typeof listQuery>>(req, 'query')
  const { rows } = await pool.query(
    `SELECT r.id AS room_id, r.code, r.game_key, r.entry_fee, r.is_practice, r.status, r.created_at, r.ended_at,
            gr.outcome, gr.winner_user_id, gr.prize_pool,
            (SELECT COALESCE(SUM(amount), 0)::bigint FROM ledger_transactions lt
              WHERE lt.game_id = r.id AND lt.user_id = $1 AND lt.transaction_type = 'PRIZE') AS my_prize,
            (SELECT json_agg(json_build_object('seat', gp2.seat, 'name', COALESCE(p2.display_name, gp2.bot_name)) ORDER BY gp2.seat)
               FROM game_players gp2 LEFT JOIN user_profiles p2 ON p2.user_id = gp2.user_id WHERE gp2.room_id = r.id) AS players
       FROM game_players gp JOIN game_rooms r ON r.id = gp.room_id LEFT JOIN game_results gr ON gr.room_id = r.id
      WHERE gp.user_id = $1 AND r.status IN ('COMPLETED', 'CANCELLED') AND ($3 OR NOT r.is_practice)
      ORDER BY COALESCE(r.ended_at, r.created_at) DESC LIMIT $2`,
    [me.id, limit, includePractice],
  )
  res.json({
    items: rows.map((r) => ({
      ...r,
      result: r.status === 'CANCELLED' ? 'CANCELLED' : r.outcome === 'DRAW' ? 'DRAW' : r.winner_user_id === me.id ? 'WON' : 'LOST',
    })),
  })
})

/** Full audit view of one game: players, every move, winner, settlement and the caller's ledger lines. */
historyRouter.get('/:roomId', validate(z.object({ roomId: z.uuid() }), 'params'), async (req, res) => {
  const me = currentUser(req)
  const roomId = String(req.params.roomId)
  const { rows: rooms } = await pool.query('SELECT * FROM game_rooms WHERE id = $1', [roomId])
  if (!rooms[0]) throw Errors.notFound('Game')
  const { rows: players } = await pool.query(
    `SELECT gp.seat, gp.user_id, gp.status, u.username, COALESCE(p.display_name, gp.bot_name) AS display_name, p.avatar, gp.bot_name IS NOT NULL AS is_bot
       FROM game_players gp LEFT JOIN users u ON u.id = gp.user_id LEFT JOIN user_profiles p ON p.user_id = gp.user_id
      WHERE gp.room_id = $1 ORDER BY gp.seat`,
    [roomId],
  )
  if (!players.some((p) => p.user_id === me.id) && me.role !== 'ADMIN') throw Errors.forbidden()
  const [{ rows: moves }, { rows: result }, { rows: transactions }] = await Promise.all([
    pool.query('SELECT seq, seat, move, created_at FROM game_moves WHERE room_id = $1 ORDER BY seq', [roomId]),
    pool.query('SELECT id, outcome, winner_user_id, winner_seat, prize_pool, settled_at FROM game_results WHERE room_id = $1', [roomId]),
    pool.query(
      `SELECT transaction_id, user_id, amount, transaction_type, entry_kind, status, idempotency_key, created_at
         FROM ledger_transactions WHERE game_id = $1 AND (user_id = $2 OR $3) ORDER BY created_at`,
      [roomId, me.id, me.role === 'ADMIN'],
    ),
  ])
  res.json({ room: rooms[0], players, moves, settlement: result[0] ?? null, transactions })
})
