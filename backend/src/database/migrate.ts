import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './pool.js'
import { logger } from '../lib/logger.js'

const here = dirname(fileURLToPath(import.meta.url))
// Works from src/ (tsx) and dist/ (compiled), and inside the Docker image (/app/database/migrations).
export const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? resolve(here, '../../../database/migrations')

/** Applies pending .sql migrations in filename order, each in its own transaction, recorded in schema_migrations. */
export async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  // Serialize concurrent migrators (e.g. several replicas starting at once).
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(727272)')
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations')
    const applied = new Set(rows.map((r) => r.name))
    for (const file of files) {
      if (applied.has(file)) continue
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        logger.info({ file }, 'migration applied')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727272)').catch(() => {})
    client.release()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  migrate()
    .then(() => logger.info('migrations complete'))
    .catch((err) => {
      logger.error({ err }, 'migration failed')
      process.exitCode = 1
    })
    .finally(() => pool.end())
}
