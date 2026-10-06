import { Router } from 'express'
import { z } from 'zod'
import { authenticate, currentUser } from '../../middleware/auth.js'
import { input, validate } from '../../middleware/validate.js'
import * as wallet from './wallet.service.js'

export const walletRouter = Router()
walletRouter.use(authenticate)

const txQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.iso.datetime({ offset: true }).optional(),
  type: z.enum(['SIGNUP_BONUS', 'ENTRY_FEE', 'PRIZE', 'REFUND']).optional(),
})

/** Read-only: credits can only be earned via the welcome grant and game prizes. */
walletRouter.get('/', async (req, res) => {
  res.json({ wallet: await wallet.getSummary(currentUser(req).id) })
})

walletRouter.get('/transactions', validate(txQuery, 'query'), async (req, res) => {
  res.json(await wallet.listTransactions(currentUser(req).id, input(req, 'query')))
})
