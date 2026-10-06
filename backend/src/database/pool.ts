import pg from 'pg'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'

// BIGINT columns hold integer credits well within Number.MAX_SAFE_INTEGER — parse them as numbers.
pg.types.setTypeParser(20, (v) => Number(v))

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 20 })
pool.on('error', (err) => logger.error({ err }, 'postgres pool error'))

export type Db = pg.Pool | pg.PoolClient

/** Runs `fn` inside a transaction; commits on success, rolls back on any error. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>, isolation: 'READ COMMITTED' | 'SERIALIZABLE' = 'READ COMMITTED'): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`)
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === '23505'
