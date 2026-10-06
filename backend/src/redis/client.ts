import { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'

/**
 * Redis holds EPHEMERAL state only: live room snapshots, presence, matchmaking queues,
 * rate-limit counters and caches. It is never the source of truth for credits.
 */
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false })
redis.on('error', (err) => logger.error({ err }, 'redis error'))

export const keys = {
  roomState: (roomId: string) => `ga:room:${roomId}:state`,
  presence: (userId: string) => `ga:presence:${userId}`,
  online: 'ga:online',
  matchQueue: (gameKey: string, fee: number) => `ga:mm:${gameKey}:${fee}`,
  rate: (bucket: string, id: string) => `ga:rl:${bucket}:${id}`,
  cache: (name: string) => `ga:cache:${name}`,
}

export async function cached<T>(name: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const key = keys.cache(name)
  const hit = await redis.get(key)
  if (hit) return JSON.parse(hit) as T
  const value = await load()
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
  return value
}

export async function invalidate(...names: string[]) {
  if (names.length) await redis.del(...names.map(keys.cache))
}
