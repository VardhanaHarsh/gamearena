import { useAuth } from '../store/auth'
import type { Me } from '../types/api'

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

let refreshing: Promise<boolean> | null = null

/** Single-flight refresh using the httpOnly cookie. Rotates the refresh token server-side. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then(async (res) => {
      if (!res.ok) {
        useAuth.getState().clear()
        return false
      }
      const body = (await res.json()) as { accessToken: string; user: Me }
      useAuth.getState().setSession(body.accessToken, body.user)
      return true
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  auth?: boolean
}

export async function api<T>(path: string, { method = 'GET', body, auth = true }: Options = {}, retried = false): Promise<T> {
  const token = useAuth.getState().accessToken
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).catch(() => {
    throw new ApiError(0, 'NETWORK', 'Connection lost. Please check your network.')
  })

  if (res.status === 401 && auth && !retried && path !== '/auth/refresh') {
    if (await refreshSession()) return api<T>(path, { method, body, auth }, true)
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; details?: unknown } }).error
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? 'Something went wrong.', err?.details)
  }
  return data as T
}
