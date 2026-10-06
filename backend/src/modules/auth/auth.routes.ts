import { Router } from 'express'
import { z } from 'zod'
import { authenticate, currentUser } from '../../middleware/auth.js'
import { clientIp, rateLimit } from '../../middleware/rateLimit.js'
import { sha256 } from '../../lib/random.js'
import { input, validate } from '../../middleware/validate.js'
import * as auth from './auth.service.js'
import { getMe } from '../users/users.service.js'

const password = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/[0-9]/, 'Must contain a number')

const registerSchema = z.object({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  username: z.string().regex(/^[A-Za-z0-9_]{3,20}$/, '3–20 letters, numbers or underscores'),
  displayName: z.string().trim().min(1).max(40),
  password,
})
const loginSchema = z.object({ identifier: z.string().trim().min(3).max(254), password: z.string().min(1).max(128) })
const forgotSchema = z.object({ email: z.email().transform((e) => e.toLowerCase()) })
const resetSchema = z.object({ token: z.string().min(20).max(200), password })

export const authRouter = Router()

authRouter.post('/register', rateLimit('register', 30, 3600), validate(registerSchema), async (req, res) => {
  const body = input<z.infer<typeof registerSchema>>(req)
  const user = await auth.register(body, clientIp(req))
  const tokens = await auth.issueTokens({ id: user.id, role: user.role, username: user.username })
  auth.setRefreshCookie(res, tokens.refreshToken)
  res.status(201).json({ accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, user: await getMe(user.id) })
})

authRouter.post('/login', rateLimit('login-ip', 100, 900), rateLimit('login', 10, 900, (req) => `${clientIp(req)}:${String(req.body?.identifier ?? '').toLowerCase()}`), validate(loginSchema), async (req, res) => {
  const { identifier, password } = input<z.infer<typeof loginSchema>>(req)
  const user = await auth.login(identifier, password, clientIp(req))
  const tokens = await auth.issueTokens(user)
  auth.setRefreshCookie(res, tokens.refreshToken)
  res.json({ accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, user: await getMe(user.id) })
})

authRouter.post('/refresh', rateLimit('refresh', 120, 900, (req) => sha256(String(req.cookies?.[auth.REFRESH_COOKIE] ?? clientIp(req))).slice(0, 32)), async (req, res) => {
  const presented = req.cookies?.[auth.REFRESH_COOKIE] as string | undefined
  if (!presented) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No session.' } })
    return
  }
  try {
    const rotated = await auth.rotateRefreshToken(presented)
    auth.setRefreshCookie(res, rotated.refreshToken)
    res.json({ accessToken: rotated.accessToken, expiresIn: rotated.expiresIn, user: await getMe(rotated.user.id) })
  } catch (err) {
    auth.clearRefreshCookie(res)
    throw err
  }
})

authRouter.post('/logout', async (req, res) => {
  await auth.logout(req.cookies?.[auth.REFRESH_COOKIE])
  auth.clearRefreshCookie(res)
  res.status(204).end()
})

authRouter.post('/forgot-password', rateLimit('forgot', 10, 3600), validate(forgotSchema), async (req, res) => {
  const { devResetUrl } = await auth.forgotPassword(input<z.infer<typeof forgotSchema>>(req).email)
  res.json({ message: 'If that email is registered, a reset link has been sent.', devResetUrl })
})

authRouter.post('/reset-password', rateLimit('reset', 10, 3600), validate(resetSchema), async (req, res) => {
  const { token, password } = input<z.infer<typeof resetSchema>>(req)
  await auth.resetPassword(token, password)
  res.json({ message: 'Password updated. Please sign in.' })
})

authRouter.get('/me', authenticate, async (req, res) => {
  res.json({ user: await getMe(currentUser(req).id) })
})
