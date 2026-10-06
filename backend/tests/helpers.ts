import { randomUUID } from 'node:crypto'
import { migrate } from '../src/database/migrate.js'
import { pool } from '../src/database/pool.js'
import { register } from '../src/modules/auth/auth.service.js'
import { redis } from '../src/redis/client.js'

let migrated = false
export async function prepareDb() {
  if (!migrated) {
    await migrate()
    migrated = true
  }
  await redis.flushdb()
}

export async function makeUser(prefix = 'u') {
  const tag = `${prefix}${randomUUID().slice(0, 8)}`.replace(/-/g, '')
  return register({ email: `${tag}@test.local`, username: tag, displayName: tag, password: 'Password123!' })
}

export async function balance(userId: string) {
  const { rows } = await pool.query<{ available: number; locked: number }>('SELECT available, locked FROM wallets WHERE user_id = $1', [userId])
  return rows[0]
}
