import { Router } from 'express'
import { z } from 'zod'
import { input, validate } from '../../middleware/validate.js'
import { getLeaderboard } from './leaderboard.service.js'

export const leaderboardRouter = Router()
const query = z.object({
  period: z.enum(['global', 'weekly']).default('global'),
  game: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

leaderboardRouter.get('/', validate(query, 'query'), async (req, res) => {
  const { period, game, limit } = input<z.infer<typeof query>>(req, 'query')
  res.json({ period, game: game ?? null, entries: await getLeaderboard(period, game, limit), currency: 'VIRTUAL_CREDITS' })
})
