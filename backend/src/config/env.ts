import { z } from 'zod'

/**
 * Validated configuration. The process refuses to start with missing/weak secrets,
 * GameArena uses virtual credits only — there is no payment, deposit or withdrawal integration.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // On Render, RENDER_EXTERNAL_URL (the public https URL) is used when these are not set explicitly.
  CORS_ORIGINS: z.string().default(process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173'),
  FRONTEND_URL: z.string().url().default(process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173'),
  /** When set, the API also serves the built SPA from this directory (single-service deployment). */
  STATIC_DIR: z.string().optional(),
  /** Seed demo data on boot (idempotent). */
  SEED_ON_START: z.enum(['true', 'false']).default('false'),
  /** Admin password for seeding. Required in production — never use the README demo password on a public site. */
  ADMIN_PASSWORD: z.string().min(12).optional(),
  DEMO_MODE: z.literal('true', { error: 'DEMO_MODE must be "true" — GameArena is a virtual-credits prototype only' }),
  SIGNUP_BONUS_CREDITS: z.coerce.number().int().positive().max(1_000_000).default(1000),
  TURN_SECONDS: z.coerce.number().int().min(5).max(120).default(25),
  RECONNECT_GRACE_SECONDS: z.coerce.number().int().min(5).max(600).default(60),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

const parsed = schema
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === 'production' && v.SEED_ON_START === 'true' && !v.ADMIN_PASSWORD) {
      ctx.addIssue({ code: 'custom', path: ['ADMIN_PASSWORD'], message: 'Required in production when SEED_ON_START=true' })
    }
  })
  .safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment configuration:')
  for (const issue of parsed.error.issues) console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
  process.exit(1)
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
}
