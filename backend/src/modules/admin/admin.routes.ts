import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../../database/pool.js'
import { Errors } from '../../lib/errors.js'
import { authenticate, currentUser, requireRole } from '../../middleware/auth.js'
import { input, validate } from '../../middleware/validate.js'
import { keys, redis } from '../../redis/client.js'
import { gameServer } from '../../websocket/gameServer.js'
import { AntiCheatService } from '../anticheat/anticheat.service.js'
import { audit } from '../audit/audit.service.js'
import { reconcile } from '../ledger/ledger.service.js'
import { notify } from '../notifications/notification.service.js'

export const adminRouter = Router()
adminRouter.use(authenticate, requireRole('ADMIN'))

const startedAt = Date.now()

adminRouter.get('/overview', async (_req, res) => {
  const [{ rows: counts }, online] = await Promise.all([
    pool.query(`SELECT
        (SELECT count(*)::int FROM users) AS total_users,
        (SELECT count(*)::int FROM game_rooms WHERE status = 'IN_PROGRESS') AS games_running,
        (SELECT count(*)::int FROM game_rooms WHERE status = 'COMPLETED') AS games_completed,
        (SELECT count(*)::int FROM game_rooms WHERE status IN ('WAITING','READY','STARTING')) AS open_rooms,
        (SELECT count(*)::int FROM ledger_transactions) AS ledger_transactions,
        (SELECT count(*)::int FROM ledger_transactions WHERE status = 'FAILED') AS failed_transactions,
        (SELECT count(*)::int FROM audit_logs WHERE action = 'game.settlement_failed' AND created_at > now() - interval '24 hours') AS failed_settlements,
        (SELECT count(*)::int FROM anticheat_flags WHERE created_at > now() - interval '24 hours') AS flags_24h,
        (SELECT COALESCE(SUM(available + locked), 0)::bigint FROM wallets) AS credits_in_circulation`),
    redis.zcount(keys.online, Date.now() - 5 * 60 * 1000, '+inf'),
  ])
  res.json({ ...counts[0], active_players: online })
})

adminRouter.get('/charts', async (_req, res) => {
  const [games, players, popularity, volume] = await Promise.all([
    pool.query(`SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(c.n, 0)::int AS value
                  FROM generate_series(current_date - 13, current_date, '1 day') d
                  LEFT JOIN (SELECT date_trunc('day', settled_at)::date AS day, count(*) AS n FROM game_results GROUP BY 1) c ON c.day = d::date
                 ORDER BY d`),
    pool.query(`SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(c.n, 0)::int AS value
                  FROM generate_series(current_date - 13, current_date, '1 day') d
                  LEFT JOIN (SELECT date_trunc('day', gp.joined_at)::date AS day, count(DISTINCT gp.user_id) AS n
                               FROM game_players gp WHERE gp.user_id IS NOT NULL GROUP BY 1) c ON c.day = d::date
                 ORDER BY d`),
    pool.query(`SELECT game_key AS label, count(*)::int AS value FROM game_rooms WHERE status = 'COMPLETED' GROUP BY game_key ORDER BY value DESC`),
    pool.query(`SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(c.n, 0)::bigint AS value
                  FROM generate_series(current_date - 13, current_date, '1 day') d
                  LEFT JOIN (SELECT date_trunc('day', created_at)::date AS day, SUM(amount) AS n FROM ledger_transactions
                              WHERE transaction_type IN ('ENTRY_FEE','PRIZE') AND entry_kind IN ('HOLD','CREDIT') GROUP BY 1) c ON c.day = d::date
                 ORDER BY d`),
  ])
  res.json({ gamesPerDay: games.rows, playersPerDay: players.rows, gamePopularity: popularity.rows, creditsVolume: volume.rows })
})

adminRouter.get('/health', async (_req, res) => {
  const t0 = Date.now()
  const db = await pool.query('SELECT 1').then(() => ({ ok: true, latencyMs: Date.now() - t0 }), (e: Error) => ({ ok: false, error: e.message }))
  const t1 = Date.now()
  const cache = await redis.ping().then(() => ({ ok: true, latencyMs: Date.now() - t1 }), (e: Error) => ({ ok: false, error: e.message }))
  const mem = process.memoryUsage()
  res.json({
    status: db.ok && cache.ok ? 'healthy' : 'degraded',
    postgres: db,
    redis: cache,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    memoryMb: Math.round(mem.rss / 1024 / 1024),
    liveRooms: gameServer.monitor().length,
    node: process.version,
  })
})

adminRouter.get('/reconciliation', async (_req, res) => {
  res.json(await reconcile())
})

// ---------------------------------------------------------------- users
const usersQuery = z.object({ q: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) })
adminRouter.get('/users', validate(usersQuery, 'query'), async (req, res) => {
  const { q, limit } = input<z.infer<typeof usersQuery>>(req, 'query')
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.username, u.role, u.status, u.created_at, p.display_name, w.available, w.locked,
            (SELECT count(*)::int FROM anticheat_flags f WHERE f.user_id = u.id) AS flags
       FROM users u JOIN user_profiles p ON p.user_id = u.id LEFT JOIN wallets w ON w.user_id = u.id
      WHERE $1::text IS NULL OR u.username ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%'
      ORDER BY u.created_at DESC LIMIT $2`,
    [q ?? null, limit],
  )
  res.json({ users: rows })
})

adminRouter.get('/users/:id/risk', validate(z.object({ id: z.uuid() }), 'params'), async (req, res) => {
  res.json(await AntiCheatService.detectSuspiciousActivity(String(req.params.id)))
})

const statusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().min(3).max(200) })
adminRouter.post('/users/:id/status', validate(z.object({ id: z.uuid() }), 'params'), validate(statusSchema), async (req, res) => {
  const admin = currentUser(req)
  const id = String(req.params.id)
  if (id === admin.id) throw Errors.badRequest('You cannot change your own status.')
  const { status, reason } = input<z.infer<typeof statusSchema>>(req)
  const { rows } = await pool.query(`UPDATE users SET status = $2, updated_at = now() WHERE id = $1 AND role <> 'ADMIN' RETURNING id, username, status`, [id, status])
  if (!rows[0]) throw Errors.notFound('Player')
  if (status === 'SUSPENDED') await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id])
  await audit({ actorId: admin.id, action: status === 'SUSPENDED' ? 'admin.user_suspended' : 'admin.user_reactivated', targetType: 'user', targetId: id, level: 'WARN', details: { reason } })
  await notify(id, 'ACCOUNT', status === 'SUSPENDED' ? 'Account suspended' : 'Account reactivated', `Reason: ${reason} (simulated moderation)`)
  res.json({ user: rows[0] })
})

// ---------------------------------------------------------------- games & rooms
adminRouter.get('/rooms/live', (_req, res) => {
  res.json({ rooms: gameServer.monitor() })
})

adminRouter.post('/rooms/:id/cancel', validate(z.object({ id: z.uuid() }), 'params'), async (req, res) => {
  res.json(await gameServer.adminCancel(String(req.params.id), currentUser(req).id))
})

adminRouter.get('/games', async (_req, res) => {
  const { rows } = await pool.query(`SELECT g.*, (SELECT count(*)::int FROM game_rooms r WHERE r.game_key = g.key) AS rooms FROM games g ORDER BY g.key`)
  res.json({ games: rows })
})

adminRouter.patch('/games/:key', validate(z.object({ enabled: z.boolean().optional(), defaultEntry: z.number().int().min(0).max(5000).optional() })), async (req, res) => {
  const body = input<{ enabled?: boolean; defaultEntry?: number }>(req)
  const { rows } = await pool.query(
    `UPDATE games SET enabled = COALESCE($2, enabled), default_entry = COALESCE($3, default_entry) WHERE key = $1 RETURNING *`,
    [req.params.key, body.enabled ?? null, body.defaultEntry ?? null],
  )
  if (!rows[0]) throw Errors.notFound('Game')
  await audit({ actorId: currentUser(req).id, action: 'admin.game_updated', targetType: 'game', targetId: String(req.params.key), details: body })
  res.json({ game: rows[0] })
})

adminRouter.get('/results', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT gr.id, gr.room_id, gr.game_key, gr.outcome, gr.winner_seat, gr.prize_pool, gr.settled_at, r.code,
            u.username AS winner_username, (SELECT count(*)::int FROM game_moves m WHERE m.room_id = gr.room_id) AS moves
       FROM game_results gr JOIN game_rooms r ON r.id = gr.room_id LEFT JOIN users u ON u.id = gr.winner_user_id
      ORDER BY gr.settled_at DESC LIMIT 100`,
  )
  res.json({ results: rows })
})

// ---------------------------------------------------------------- audit trails
const txQuery = z.object({
  type: z.enum(['SIGNUP_BONUS', 'ENTRY_FEE', 'PRIZE', 'REFUND']).optional(),
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'REVERSED']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})
adminRouter.get('/transactions', validate(txQuery, 'query'), async (req, res) => {
  const { type, status, limit } = input<z.infer<typeof txQuery>>(req, 'query')
  const { rows } = await pool.query(
    `SELECT l.*, u.username FROM ledger_transactions l JOIN users u ON u.id = l.user_id
      WHERE ($1::text IS NULL OR l.transaction_type = $1) AND ($2::text IS NULL OR l.status = $2)
      ORDER BY l.created_at DESC LIMIT $3`,
    [type ?? null, status ?? null, limit],
  )
  res.json({ transactions: rows })
})

adminRouter.get('/flags', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT f.*, u.username FROM anticheat_flags f JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC LIMIT 100`,
  )
  res.json({ flags: rows })
})

const logQuery = z.object({ level: z.enum(['INFO', 'WARN', 'ERROR']).optional(), action: z.string().max(60).optional() })
adminRouter.get('/logs', validate(logQuery, 'query'), async (req, res) => {
  const { level, action } = input<z.infer<typeof logQuery>>(req, 'query')
  const { rows } = await pool.query(
    `SELECT a.*, u.username AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE ($1::text IS NULL OR a.level = $1) AND ($2::text IS NULL OR a.action LIKE $2 || '%')
      ORDER BY a.created_at DESC LIMIT 200`,
    [level ?? null, action ?? null],
  )
  res.json({ logs: rows })
})
