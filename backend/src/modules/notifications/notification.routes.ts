import { Router } from 'express'
import { z } from 'zod'
import { authenticate, currentUser } from '../../middleware/auth.js'
import { input, validate } from '../../middleware/validate.js'
import { list, markRead } from './notification.service.js'

export const notificationsRouter = Router()
notificationsRouter.use(authenticate)

notificationsRouter.get('/', async (req, res) => {
  res.json(await list(currentUser(req).id))
})

notificationsRouter.post('/read', validate(z.object({ ids: z.array(z.uuid()).max(100).optional() })), async (req, res) => {
  await markRead(currentUser(req).id, input<{ ids?: string[] }>(req).ids)
  res.status(204).end()
})
