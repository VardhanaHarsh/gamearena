import { io, type Socket } from 'socket.io-client'
import { refreshSession } from './api'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'

let socket: Socket | null = null

export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

export class SocketError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** One authenticated socket per session. Reconnects automatically and re-authenticates with fresh tokens. */
export function getSocket(): Socket {
  if (socket) return socket
  socket = io({
    path: '/socket.io',
    transports: ['websocket'],
    auth: (cb) => cb({ token: useAuth.getState().accessToken }),
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  })
  const ui = useUi.getState()
  socket.on('connect', () => ui.setConnection('connected'))
  socket.on('disconnect', () => ui.setConnection('disconnected'))
  socket.io.on('reconnect_attempt', () => ui.setConnection('connecting'))
  socket.on('connect_error', async (err) => {
    ui.setConnection('disconnected')
    if (err.message === 'UNAUTHORIZED' && (await refreshSession())) socket?.connect()
  })
  return socket
}

export function disconnectSocket() {
  socket?.disconnect()
  socket = null
}

/** Emits with an acknowledgement and turns `{ ok:false }` into a thrown SocketError. */
export function emitAck<T>(event: string, payload: unknown, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    getSocket()
      .timeout(timeoutMs)
      .emit(event, payload, (err: Error | null, res: AckResponse<T>) => {
        if (err) return reject(new SocketError('TIMEOUT', 'Connection lost. Reconnecting...'))
        if (res.ok) resolve(res.data)
        else reject(new SocketError(res.error.code, res.error.message))
      })
  })
}
