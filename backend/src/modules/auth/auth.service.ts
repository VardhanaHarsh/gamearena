import { hash, verify } from '@node-rs/argon2'
import type { Response } from 'express'
import { randomUUID } from 'node:crypto'
import { env } from '../../config/env.js'
import { pool, withTransaction, isUniqueViolation } from '../../database/pool.js'
import { AppError, Errors } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'
import { randomToken, sha256 } from '../../lib/random.js'
import { signAccessToken, type AuthUser, type Role } from '../../middleware/auth.js'
import { audit } from '../audit/audit.service.js'
import { notify } from '../notifications/notification.service.js'
import { ensureSignupBonus } from '../wallet/wallet.service.js'

// Argon2id with OWASP-recommended parameters (19 MiB, 2 iterations).
const ARGON_OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 }
export const hashPassword = (password: string) => hash(password, ARGON_OPTS)

export const REFRESH_COOKIE = 'ga_refresh'
/** Window in which re-presenting a just-rotated refresh token is treated as a concurrent-tab race, not theft. */
const REUSE_GRACE_MS = 30_000
const refreshTtlMs = () => env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000

interface UserRow {
  id: string
  email: string
  username: string
  password_hash: string
  role: Role
  status: 'ACTIVE' | 'PAUSED' | 'SUSPENDED'
}

const toAuthUser = (u: Pick<UserRow, 'id' | 'role' | 'username'>): AuthUser => ({ id: u.id, role: u.role, username: u.username })

/** Creates user + profile + settings + wallet and grants the one-time welcome credits — all in one transaction. */
export async function register(input: { email: string; username: string; password: string; displayName: string }, ip?: string) {
  const passwordHash = await hashPassword(input.password)
  try {
    const user = await withTransaction(async (client) => {
      const { rows } = await client.query<UserRow>(
        `INSERT INTO users (email, username, password_hash) VALUES ($1, $2, $3) RETURNING id, email, username, role, status`,
        [input.email, input.username, passwordHash],
      )
      const u = rows[0]
      await client.query('INSERT INTO user_profiles (user_id, display_name) VALUES ($1, $2)', [u.id, input.displayName])
      await client.query('INSERT INTO user_settings (user_id) VALUES ($1)', [u.id])
      await ensureSignupBonus(u.id, client)
      return u
    })
    await audit({ actorId: user.id, action: 'auth.register', targetType: 'user', targetId: user.id, ip })
    await notify(user.id, 'WELCOME', 'Welcome to GameArena!', `You received ${env.SIGNUP_BONUS_CREDITS} virtual credits to play with. They have no real-world value.`, {
      amount: env.SIGNUP_BONUS_CREDITS,
    })
    return user
  } catch (err) {
    if (isUniqueViolation(err)) {
      const detail = String((err as { detail?: string }).detail ?? '')
      throw Errors.conflict('ACCOUNT_EXISTS', detail.includes('username') ? 'That username is taken.' : 'An account with that email already exists.')
    }
    throw err
  }
}

export async function login(identifier: string, password: string, ip?: string) {
  const { rows } = await pool.query<UserRow>(
    'SELECT id, email, username, password_hash, role, status FROM users WHERE email = $1 OR username = $1',
    [identifier],
  )
  const user = rows[0]
  // Always run a verify to keep timing similar whether or not the account exists.
  const ok = user ? await verify(user.password_hash, password) : await verify(DUMMY_HASH, password).then(() => false)
  if (!user || !ok) {
    await audit({ action: 'auth.login_failed', level: 'WARN', details: { identifier }, ip })
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email/username or password.')
  }
  if (user.status === 'SUSPENDED') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended.')
  // Idempotent: accounts created before the grant existed (or seeded) receive it once on first login.
  await ensureSignupBonus(user.id)
  await audit({ actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id, ip })
  return toAuthUser(user)
}
const DUMMY_HASH = await hashPassword(randomToken(16))

/** Issues an access token and a new refresh token in the given family (new family on login). */
export async function issueTokens(user: AuthUser, familyId: string = randomUUID()) {
  const refreshToken = randomToken(48)
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [user.id, familyId, sha256(refreshToken), new Date(Date.now() + refreshTtlMs())],
  )
  return { accessToken: signAccessToken(user), refreshToken, refreshTokenId: rows[0].id, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS }
}

/**
 * Rotates a refresh token. Presenting an already-rotated (revoked) token is treated as theft:
 * the whole token family is revoked, signing out every session derived from it.
 */
export async function rotateRefreshToken(presented: string) {
  const { rows } = await pool.query<{ id: string; user_id: string; family_id: string; expires_at: string; revoked_at: string | null; replaced_by: string | null }>(
    'SELECT id, user_id, family_id, expires_at, revoked_at, replaced_by FROM refresh_tokens WHERE token_hash = $1',
    [sha256(presented)],
  )
  const token = rows[0]
  if (!token) throw Errors.unauthorized('Session expired. Please sign in again.')
  if (token.revoked_at) {
    // Benign race: two tabs (or a reload) refreshing with the same cookie at the same moment.
    // If this token was rotated seconds ago and its successor is still valid, issue fresh tokens
    // in the same family instead of treating it as theft.
    if (token.replaced_by && Date.now() - new Date(token.revoked_at).getTime() < REUSE_GRACE_MS) {
      const { rows: successor } = await pool.query<{ revoked_at: string | null }>('SELECT revoked_at FROM refresh_tokens WHERE id = $1', [token.replaced_by])
      if (successor[0] && !successor[0].revoked_at) {
        const { rows: users } = await pool.query<UserRow>('SELECT id, username, role, status FROM users WHERE id = $1', [token.user_id])
        if (users[0] && users[0].status !== 'SUSPENDED') {
          const issued = await issueTokens(toAuthUser(users[0]), token.family_id)
          return { user: toAuthUser(users[0]), ...issued }
        }
      }
    }
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [token.family_id])
    await audit({ actorId: token.user_id, action: 'auth.refresh_token_reuse', level: 'WARN', details: { familyId: token.family_id } })
    throw Errors.unauthorized('Session expired. Please sign in again.')
  }
  if (new Date(token.expires_at) < new Date()) throw Errors.unauthorized('Session expired. Please sign in again.')

  const { rows: users } = await pool.query<UserRow>('SELECT id, username, role, status FROM users WHERE id = $1', [token.user_id])
  const user = users[0]
  if (!user || user.status === 'SUSPENDED') throw Errors.unauthorized()

  const issued = await issueTokens(toAuthUser(user), token.family_id)
  const { rowCount } = await pool.query(
    'UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1 AND revoked_at IS NULL',
    [token.id, issued.refreshTokenId],
  )
  if (rowCount === 0) {
    // Lost a race with a concurrent rotation of the same token → treat as reuse.
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1', [token.family_id])
    throw Errors.unauthorized('Session expired. Please sign in again.')
  }
  return { user: toAuthUser(user), ...issued }
}

export async function logout(presented: string | undefined) {
  if (!presented) return
  await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(presented)])
}

/**
 * Always resolves (no account enumeration). There is no email service in this prototype, so the
 * reset link is written to the server log and — outside production only — returned for the demo UI.
 */
export async function forgotPassword(email: string) {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])
  if (!rows[0]) return { devResetUrl: undefined }
  const token = randomToken(32)
  await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 minutes')`, [rows[0].id, sha256(token)])
  const url = `${env.FRONTEND_URL}/reset-password?token=${token}`
  logger.info({ email }, `[simulated email outbox] password reset link: ${url}`)
  await audit({ actorId: rows[0].id, action: 'auth.password_reset_requested' })
  return { devResetUrl: env.isProd ? undefined : url }
}

export async function resetPassword(token: string, newPassword: string) {
  const passwordHash = await hashPassword(newPassword)
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
      [sha256(token)],
    )
    if (!rows[0]) throw new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired.')
    await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [rows[0].id])
    await client.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [rows[0].user_id, passwordHash])
    // Sign out every existing session.
    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [rows[0].user_id])
    await audit({ actorId: rows[0].user_id, action: 'auth.password_reset' }, client)
  })
}

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: refreshTtlMs(),
  })
}
export const clearRefreshCookie = (res: Response) => res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' })
