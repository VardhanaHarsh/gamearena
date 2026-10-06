import type { NextFunction, Request, Response } from 'express'
import { Errors } from '../lib/errors.js'
import { keys, redis } from '../redis/client.js'
import { logger } from '../lib/logger.js'

/**
 * Fixed-window rate limiter backed by Redis (shared across instances).
 * Keyed by user id when authenticated, otherwise by IP.
 */
/**
 * Real client IP. On Render the request passes through Cloudflare and Render's proxy, so `req.ip`
 * may be a proxy address shared by everyone; Cloudflare's CF-Connecting-IP / True-Client-IP are set by
 * the edge (a client cannot forge them there). Only trusted when running on Render.
 */
export function clientIp(req: Request) {
  if (process.env.RENDER) {
    const edge = req.headers['cf-connecting-ip'] ?? req.headers['true-client-ip']
    if (typeof edge === 'string' && edge) return edge
  }
  return req.ip ?? 'unknown'
}

type KeyFn = (req: Request) => string

export function rateLimit(bucket: string, limit: number, windowSeconds: number, keyFn?: KeyFn) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const id = keyFn?.(req) ?? req.user?.id ?? clientIp(req)
    const key = keys.rate(bucket, id)
    try {
      const count = await redis.incr(key)
      if (count === 1) await redis.expire(key, windowSeconds)
      res.setHeader('RateLimit-Limit', String(limit))
      res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - count)))
      if (count > limit) return next(Errors.tooMany())
      next()
    } catch (err) {
      // Fail open on Redis outage so auth still works, but make the outage visible.
      logger.warn({ err }, 'rate limiter unavailable')
      next()
    }
  }
}

/** Same counter logic for WebSocket events. Returns false when the caller is over the limit. */
export async function allowEvent(bucket: string, id: string, limit: number, windowSeconds: number) {
  const key = keys.rate(bucket, id)
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, windowSeconds)
  return count <= limit
}
