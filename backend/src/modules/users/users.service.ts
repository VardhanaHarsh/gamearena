import { pool } from '../../database/pool.js'
import { Errors } from '../../lib/errors.js'
import { audit } from '../audit/audit.service.js'
import * as ledger from '../ledger/ledger.service.js'

export const AVATARS = ['falcon', 'tiger', 'wolf', 'fox', 'owl', 'shark', 'dragon', 'panda', 'eagle', 'lion'] as const

export const levelFromXp = (xp: number) => {
  const level = Math.floor(Math.sqrt(xp / 100)) + 1
  const floor = (level - 1) ** 2 * 100
  const next = level ** 2 * 100
  return { level, xp, progress: (xp - floor) / (next - floor), nextLevelXp: next }
}

/** Aggregated player statistics (practice games excluded). */
export async function getStats(userId: string) {
  const { rows } = await pool.query<{ game_key: string; games_played: number; wins: number; credits_won: number }>(
    'SELECT game_key, games_played, wins, credits_won FROM leaderboards WHERE user_id = $1',
    [userId],
  )
  const gamesPlayed = rows.reduce((s, r) => s + r.games_played, 0)
  const wins = rows.reduce((s, r) => s + r.wins, 0)
  const creditsWon = rows.reduce((s, r) => s + r.credits_won, 0)
  const favorite = [...rows].sort((a, b) => b.games_played - a.games_played)[0]
  const { rows: rank } = await pool.query<{ rank: number }>(
    `SELECT rank FROM (
       SELECT user_id, RANK() OVER (ORDER BY SUM(wins) DESC, SUM(credits_won) DESC) AS rank
       FROM leaderboards GROUP BY user_id
     ) r WHERE user_id = $1`,
    [userId],
  )
  return {
    gamesPlayed,
    wins,
    losses: gamesPlayed - wins,
    winRate: gamesPlayed ? wins / gamesPlayed : 0,
    creditsWon,
    favoriteGame: favorite?.game_key ?? null,
    leaderboardRank: rank[0]?.rank ?? null,
    perGame: rows,
  }
}

export async function getMe(userId: string) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.username, u.role, u.status, u.created_at,
            p.display_name, p.avatar, p.phone, p.xp,
            s.daily_spend_limit, s.break_reminder_minutes, s.paused_until
       FROM users u JOIN user_profiles p ON p.user_id = u.id LEFT JOIN user_settings s ON s.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  )
  const u = rows[0]
  if (!u) throw Errors.notFound('User')
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    role: u.role,
    status: u.status,
    createdAt: u.created_at,
    displayName: u.display_name,
    avatar: u.avatar,
    phone: u.phone,
    level: levelFromXp(u.xp),
    settings: {
      dailySpendLimit: u.daily_spend_limit,
      breakReminderMinutes: u.break_reminder_minutes,
      pausedUntil: u.paused_until,
    },
    wallet: await ledger.getBalance(userId),
  }
}

export async function getPublicProfile(username: string) {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.created_at, p.display_name, p.avatar, p.xp
       FROM users u JOIN user_profiles p ON p.user_id = u.id WHERE u.username = $1`,
    [username],
  )
  const u = rows[0]
  if (!u) throw Errors.notFound('Player')
  const { rows: recent } = await pool.query(
    `SELECT r.id AS room_id, r.game_key, gr.outcome, gr.winner_user_id = $1 AS won, gr.settled_at
       FROM game_players gp JOIN game_rooms r ON r.id = gp.room_id JOIN game_results gr ON gr.room_id = r.id
      WHERE gp.user_id = $1 AND NOT r.is_practice ORDER BY gr.settled_at DESC LIMIT 10`,
    [u.id],
  )
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatar: u.avatar,
    memberSince: u.created_at,
    level: levelFromXp(u.xp),
    stats: await getStats(u.id),
    recent,
  }
}

export async function updateProfile(userId: string, patch: { displayName?: string; avatar?: string; phone?: string | null }) {
  await pool.query(
    `UPDATE user_profiles SET
       display_name = COALESCE($2, display_name),
       avatar = COALESCE($3, avatar),
       phone = CASE WHEN $5 THEN $4 ELSE phone END,
       updated_at = now()
     WHERE user_id = $1`,
    [userId, patch.displayName ?? null, patch.avatar ?? null, patch.phone ?? null, patch.phone !== undefined],
  )
  return getMe(userId)
}

/** Responsible-gaming controls (prototype). */
export async function updateSettings(userId: string, patch: { dailySpendLimit?: number | null; breakReminderMinutes?: number }) {
  await pool.query(
    `UPDATE user_settings SET
       daily_spend_limit = CASE WHEN $3 THEN $2 ELSE daily_spend_limit END,
       break_reminder_minutes = COALESCE($4, break_reminder_minutes),
       updated_at = now()
     WHERE user_id = $1`,
    [userId, patch.dailySpendLimit ?? null, patch.dailySpendLimit !== undefined, patch.breakReminderMinutes ?? null],
  )
  await audit({ actorId: userId, action: 'rg.settings_updated', details: patch })
  return getMe(userId)
}

/** Self-exclusion "cool-off": blocks joining paid rooms until the given time. Cannot be shortened. */
export async function pauseAccount(userId: string, hours: number) {
  await pool.query(
    `UPDATE user_settings SET paused_until = GREATEST(COALESCE(paused_until, now()), now() + make_interval(hours => $2)), updated_at = now()
     WHERE user_id = $1`,
    [userId, hours],
  )
  await audit({ actorId: userId, action: 'rg.account_paused', details: { hours } })
  return getMe(userId)
}
