import { pool } from '../../database/pool.js'
import { cached } from '../../redis/client.js'

export type Period = 'global' | 'weekly'

/**
 * Global & per-game boards read the running totals in `leaderboards` (maintained by settlement).
 * Weekly boards aggregate the last 7 days of `game_results`. Results are cached in Redis briefly.
 */
export async function getLeaderboard(period: Period, gameKey?: string, limit = 50) {
  const cacheName = `leaderboard:${period}${gameKey ? `:${gameKey}` : ''}`
  return cached(cacheName, 30, async () => {
    if (period === 'global') {
      const { rows } = await pool.query(
        `SELECT u.id AS user_id, u.username, p.display_name, p.avatar,
                SUM(l.games_played)::int AS games, SUM(l.wins)::int AS wins, SUM(l.credits_won)::bigint AS credits_won
           FROM leaderboards l JOIN users u ON u.id = l.user_id JOIN user_profiles p ON p.user_id = u.id
          WHERE ($1::text IS NULL OR l.game_key = $1) AND u.status <> 'SUSPENDED'
          GROUP BY u.id, p.display_name, p.avatar
         HAVING SUM(l.games_played) > 0
          ORDER BY wins DESC, credits_won DESC, games ASC LIMIT $2`,
        [gameKey ?? null, limit],
      )
      return withRank(rows)
    }
    const { rows } = await pool.query(
      `WITH played AS (
         SELECT gp.user_id, r.game_key, gr.winner_user_id, gr.outcome, gr.room_id
           FROM game_results gr JOIN game_rooms r ON r.id = gr.room_id JOIN game_players gp ON gp.room_id = r.id
          WHERE gr.settled_at > now() - interval '7 days' AND NOT r.is_practice AND gp.user_id IS NOT NULL
            AND ($1::text IS NULL OR r.game_key = $1)
       ), prizes AS (
         SELECT user_id, SUM(amount)::bigint AS won FROM ledger_transactions
          WHERE transaction_type = 'PRIZE' AND created_at > now() - interval '7 days' GROUP BY user_id
       )
       SELECT u.id AS user_id, u.username, pr.display_name, pr.avatar,
              count(*)::int AS games, count(*) FILTER (WHERE p.winner_user_id = p.user_id)::int AS wins,
              COALESCE(MAX(z.won), 0)::bigint AS credits_won
         FROM played p JOIN users u ON u.id = p.user_id JOIN user_profiles pr ON pr.user_id = u.id
         LEFT JOIN prizes z ON z.user_id = u.id
        WHERE u.status <> 'SUSPENDED'
        GROUP BY u.id, pr.display_name, pr.avatar
        ORDER BY wins DESC, credits_won DESC LIMIT $2`,
      [gameKey ?? null, limit],
    )
    return withRank(rows)
  })
}

function withRank(rows: { games: number; wins: number }[]) {
  return rows.map((r, i) => ({ rank: i + 1, ...r, winRate: r.games ? r.wins / r.games : 0 }))
}
