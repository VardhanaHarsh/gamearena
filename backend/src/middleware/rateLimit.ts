import type { NextFunction, Request, Response } from 'express'
import { Errors } from '../lib/errors.js'
import { keys, redis } from '../redis/client.js'
import { logger } from '../lib/logger.js'

/**
 * Fixed-window rate limiter backed by Redis (shared across instances).
 * Keyed by user id when authenticated, otherwise by IP.
 */
export function rateLimit(bucket: string, limit: number, windowSeconds: number) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const id = req.user?.id ?? req.ip ?? 'unknown'
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
