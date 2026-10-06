import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../../database/pool.js'
import { Errors } from '../../lib/errors.js'
import { authenticate, currentUser } from '../../middleware/auth.js'
import { rateLimit } from '../../middleware/rateLimit.js'
import { input, validate } from '../../middleware/validate.js'
import { gameServer } from '../../websocket/gameServer.js'
import * as rooms from './rooms.service.js'

export const roomsRouter = Router()
roomsRouter.use(authenticate)

const createSchema = z.object({
  gameKey: z.string().min(1).max(40),
  entryFee: z.number().int().min(0).max(rooms.MAX_ENTRY_FEE),
  maxPlayers: z.number().int().min(2).max(4),
  isPrivate: z.boolean().default(false),
})
const practiceSchema = z.object({ gameKey: z.string().min(1).max(40), players: z.number().int().min(2).max(4).default(2) })
const quickSchema = z.object({ gameKey: z.string().min(1).max(40), entryFee: z.number().int().min(0).max(rooms.MAX_ENTRY_FEE) })
const listSchema = z.object({ gameKey: z.string().max(40).optional() })
const idParam = z.object({ id: z.string().min(4).max(64) })

roomsRouter.get('/', validate(listSchema, 'query'), async (req, res) => {
  res.json({ rooms: await rooms.listOpenRooms(input<{ gameKey?: string }>(req, 'query').gameKey), currency: 'VIRTUAL_CREDITS' })
})

/** The caller's current unfinished room, if any (used to resume after a refresh). */
roomsRouter.get('/mine/active', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.code, r.game_key, r.status FROM game_players gp JOIN game_rooms r ON r.id = gp.room_id
      WHERE gp.user_id = $1 AND gp.status = 'JOINED' AND r.status IN ('WAITING','READY','STARTING','IN_PROGRESS')
      ORDER BY r.created_at DESC LIMIT 1`,
    [currentUser(req).id],
  )
  res.json({ room: rows[0] ?? null })
})

roomsRouter.post('/', rateLimit('room-create', 20, 600), validate(createSchema), async (req, res) => {
  const me = currentUser(req)
  const room = await rooms.createRoom(me.id, input(req))
  await gameServer.membershipChanged(room.id)
  res.status(201).json(await gameServer.getRoomView(room.id))
})

roomsRouter.post('/practice', rateLimit('room-create', 20, 600), validate(practiceSchema), async (req, res) => {
  const { gameKey, players } = input<z.infer<typeof practiceSchema>>(req)
  const room = await rooms.createPracticeRoom(currentUser(req).id, gameKey, players)
  await gameServer.membershipChanged(room.id)
  res.status(201).json(await gameServer.getRoomView(room.id))
})

roomsRouter.post('/quick-match', rateLimit('room-create', 20, 600), validate(quickSchema), async (req, res) => {
  const me = currentUser(req)
  const { gameKey, entryFee } = input<z.infer<typeof quickSchema>>(req)
  const room = await rooms.quickMatch(me.id, gameKey, entryFee)
  await gameServer.membershipChanged(room.id, me.id)
  res.json(await gameServer.getRoomView(room.id))
})

roomsRouter.get('/:id', validate(idParam, 'params'), async (req, res) => {
  const room = await rooms.findRoom(String(req.params.id))
  if (!room) throw Errors.notFound('Room')
  res.json(await gameServer.getRoomView(room.id))
})

roomsRouter.post('/:id/join', rateLimit('room-join', 30, 60), validate(idParam, 'params'), async (req, res) => {
  const me = currentUser(req)
  const room = await rooms.findRoom(String(req.params.id))
  if (!room) throw Errors.notFound('Room')
  const joined = await rooms.joinRoom(me.id, room.id)
  await gameServer.membershipChanged(room.id, joined.alreadyJoined ? undefined : me.id)
  res.json(await gameServer.getRoomView(room.id))
})

roomsRouter.post('/:id/leave', validate(idParam, 'params'), async (req, res) => {
  const room = await rooms.findRoom(String(req.params.id))
  if (!room) throw Errors.notFound('Room')
  res.json(await gameServer.leave(currentUser(req).id, room.id))
})
