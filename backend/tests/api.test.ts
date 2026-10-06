import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { pool } from '../src/database/pool.js'
import { redis } from '../src/redis/client.js'
import { prepareDb } from './helpers.js'

const app = createApp()
beforeAll(prepareDb)
afterAll(async () => {
  await pool.end()
  redis.disconnect()
})

const cookieFrom = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('ga_refresh='))!.split(';')[0]

describe('authentication', () => {
  const user = { email: 'Auth.User@Test.local', username: 'auth_user', displayName: 'Auth User', password: 'Password123!' }
  let access = ''
  let cookie = ''

  it('registers, never stores the plaintext password, and grants 1000 credits', async () => {
    const res = await request(app).post('/api/auth/register').send(user).expect(201)
    expect(res.body.user.wallet).toEqual({ available: 1000, locked: 0, version: 1 })
    expect(res.body.accessToken).toBeTypeOf('string')
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE username = $1', [user.username])
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/)
    expect(rows[0].password_hash).not.toContain(user.password)
  })

  it('rejects duplicate accounts with 409', async () => {
    await request(app).post('/api/auth/register').send(user).expect(409)
  })

  it('logs in with username or email (case-insensitive) and sets an httpOnly refresh cookie', async () => {
    const res = await request(app).post('/api/auth/login').send({ identifier: 'auth.user@test.local', password: user.password }).expect(200)
    access = res.body.accessToken
    cookie = cookieFrom(res)
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/)
    await request(app).post('/api/auth/login').send({ identifier: 'auth_user', password: 'wrong-pass1' }).expect(401)
  })

  it('protects routes and accepts a valid access token', async () => {
    await request(app).get('/api/wallet').expect(401)
    await request(app).get('/api/wallet').set('Authorization', 'Bearer not-a-token').expect(401)
    const res = await request(app).get('/api/wallet').set('Authorization', `Bearer ${access}`).expect(200)
    expect(res.body.wallet.available).toBe(1000)
  })

  it('rotates refresh tokens and revokes the whole family when an old token is reused', async () => {
    const first = await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(200)
    const rotated = cookieFrom(first)
    expect(rotated).not.toBe(cookie)
    await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(401) // reuse → theft detected
    await request(app).post('/api/auth/refresh').set('Cookie', rotated).expect(401) // family revoked
  })

  it('password reset works once and signs out sessions', async () => {
    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: user.email }).expect(200)
    const token = new URL(forgot.body.devResetUrl).searchParams.get('token')!
    await request(app).post('/api/auth/reset-password').send({ token, password: 'NewPassword456' }).expect(200)
    await request(app).post('/api/auth/reset-password').send({ token, password: 'Another789x' }).expect(400)
    await request(app).post('/api/auth/login').send({ identifier: 'auth_user', password: 'NewPassword456' }).expect(200)
  })

  it('forgot-password does not reveal whether an account exists', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@test.local' }).expect(200)
    expect(res.body.message).toMatch(/If that email is registered/)
  })
})

describe('API validation & authorization', () => {
  let token = ''
  beforeAll(async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'v@test.local', username: 'validator', displayName: 'V', password: 'Password123!' })
    token = res.body.accessToken
  })

  it('returns 400 with field details for invalid input', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'nope', username: 'x', displayName: '', password: 'short' }).expect(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['email', 'username', 'password']))
  })

  it('rejects out-of-range entry fees and unknown games', async () => {
    await request(app).post('/api/rooms').set('Authorization', `Bearer ${token}`).send({ gameKey: 'ludo', entryFee: -5, maxPlayers: 4 }).expect(400)
    await request(app).post('/api/rooms').set('Authorization', `Bearer ${token}`).send({ gameKey: 'poker', entryFee: 10, maxPlayers: 2 }).expect(404)
    await request(app).post('/api/rooms').set('Authorization', `Bearer ${token}`).send({ gameKey: 'carrom', entryFee: 10, maxPlayers: 4 }).expect(400)
  })

  it('players cannot reach admin endpoints', async () => {
    await request(app).get('/api/admin/overview').set('Authorization', `Bearer ${token}`).expect(403)
  })

  it('admins can, and suspension takes effect immediately', async () => {
    const admin = await request(app).post('/api/auth/register').send({ email: 'adm@test.local', username: 'test_admin', displayName: 'Admin', password: 'Password123!' })
    await pool.query(`UPDATE users SET role = 'ADMIN' WHERE username = 'test_admin'`)
    const login = await request(app).post('/api/auth/login').send({ identifier: 'test_admin', password: 'Password123!' })
    const adminToken = login.body.accessToken
    void admin
    await request(app).get('/api/admin/overview').set('Authorization', `Bearer ${adminToken}`).expect(200)
    const { rows } = await pool.query(`SELECT id FROM users WHERE username = 'validator'`)
    await request(app).post(`/api/admin/users/${rows[0].id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'SUSPENDED', reason: 'test suspension' }).expect(200)
    await request(app).post('/api/auth/login').send({ identifier: 'validator', password: 'Password123!' }).expect(403)
  })

  it('there are no deposit or withdrawal endpoints', async () => {
    await request(app).post('/api/wallet/demo-deposit').set('Authorization', `Bearer ${token}`).send({ amount: 100 }).expect(404)
    await request(app).post('/api/wallet/demo-withdrawal').set('Authorization', `Bearer ${token}`).send({ amount: 100 }).expect(404)
  })
})
