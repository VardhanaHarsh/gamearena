import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { Errors } from '../lib/errors.js'

export type Role = 'PLAYER' | 'ADMIN'
export interface AuthUser {
  id: string
  role: Role
  username: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export function signAccessToken(user: AuthUser) {
  return jwt.sign({ role: user.role, username: user.username }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: 'gamearena',
    audience: 'gamearena-api',
  })
}

export function verifyAccessToken(token: string): AuthUser {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'gamearena', audience: 'gamearena-api', algorithms: ['HS256'] }) as jwt.JwtPayload
  if (!payload.sub || (payload.role !== 'PLAYER' && payload.role !== 'ADMIN')) throw new Error('malformed token')
  return { id: payload.sub, role: payload.role, username: String(payload.username) }
}

/** Requires a valid `Authorization: Bearer <access token>` header. */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return next(Errors.unauthorized())
  try {
    req.user = verifyAccessToken(header.slice(7))
    next()
  } catch {
    next(Errors.unauthorized('Session expired. Please sign in again.'))
  }
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(Errors.unauthorized())
    if (!roles.includes(req.user.role)) return next(Errors.forbidden())
    next()
  }

export const currentUser = (req: Request): AuthUser => {
  if (!req.user) throw Errors.unauthorized()
  return req.user
}
