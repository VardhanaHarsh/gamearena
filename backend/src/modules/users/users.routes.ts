import { Router } from 'express'
import { z } from 'zod'
import { authenticate, currentUser } from '../../middleware/auth.js'
import { input, validate } from '../../middleware/validate.js'
import * as users from './users.service.js'
import { spentToday } from '../ledger/ledger.service.js'
import { pool } from '../../database/pool.js'

export const usersRouter = Router()
usersRouter.use(authenticate)

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  avatar: z.enum(users.AVATARS).optional(),
  phone: z
    .string()
    .regex(/^\+?[0-9 ]{7,20}$/, 'Invalid phone number')
    .nullable()
    .optional(),
})
const settingsSchema = z.object({
  dailySpendLimit: z.number().int().min(10).max(1_000_000).nullable().optional(),
  breakReminderMinutes: z.number().int().min(5).max(600).optional(),
})
const pauseSchema = z.object({ hours: z.number().int().min(1).max(24 * 30) })

usersRouter.get('/me/stats', async (req, res) => {
  const me = currentUser(req)
  res.json({ stats: await users.getStats(me.id), spentToday: await spentToday(pool, me.id) })
})

usersRouter.patch('/me', validate(profileSchema), async (req, res) => {
  res.json({ user: await users.updateProfile(currentUser(req).id, input(req)) })
})

usersRouter.patch('/me/settings', validate(settingsSchema), async (req, res) => {
  res.json({ user: await users.updateSettings(currentUser(req).id, input(req)) })
})

usersRouter.post('/me/pause', validate(pauseSchema), async (req, res) => {
  res.json({ user: await users.pauseAccount(currentUser(req).id, input<{ hours: number }>(req).hours) })
})

usersRouter.get('/:username', async (req, res) => {
  res.json({ profile: await users.getPublicProfile(String(req.params.username)) })
})
