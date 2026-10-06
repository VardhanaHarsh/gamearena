// Test environment defaults. Integration tests need Postgres + Redis (docker compose up -d postgres redis).
process.env.NODE_ENV = 'test'
process.env.DEMO_MODE ??= 'true'
process.env.DATABASE_URL ??= 'postgres://gamearena:change-me-local-only@localhost:5432/gamearena_test'
process.env.REDIS_URL ??= 'redis://localhost:6379/15'
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-test-access-secret-0123456789'
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-test-refresh-secret-0123456789'
process.env.TURN_SECONDS ??= '30'
process.env.RECONNECT_GRACE_SECONDS ??= '5'
