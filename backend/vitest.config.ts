import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Integration tests share one Postgres/Redis — run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/globalSetup.ts'],
  },
})
