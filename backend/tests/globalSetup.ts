import pg from 'pg'

/** Creates a fresh `gamearena_test` database once per test run. */
export default async function setup() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://gamearena:change-me-local-only@localhost:5432/gamearena_test')
  const dbName = url.pathname.slice(1) || 'gamearena_test'
  url.pathname = '/postgres'
  const admin = new pg.Client({ connectionString: url.toString() })
  try {
    await admin.connect()
  } catch (err) {
    throw new Error(`Integration tests need Postgres + Redis. Start them with "docker compose up -d postgres redis". (${(err as Error).message})`)
  }
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
  await admin.query(`CREATE DATABASE ${dbName}`)
  await admin.end()
}
