import { create } from 'zustand'
import type { Me } from '../types/api'

/** The access token lives in memory only; the refresh token is an httpOnly cookie the JS can't read. */
interface AuthState {
  accessToken: string | null
  user: Me | null
  bootstrapped: boolean
  setSession: (accessToken: string, user: Me) => void
  setUser: (user: Me) => void
  setToken: (accessToken: string) => void
  clear: () => void
  setBootstrapped: () => void
}

export const useAuth = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  bootstrapped: false,
  setSession: (accessToken, user) => set({ accessToken, user }),
  setUser: (user) => set({ user }),
  setToken: (accessToken) => set({ accessToken }),
  clear: () => set({ accessToken: null, user: null }),
  setBootstrapped: () => set({ bootstrapped: true }),
}))
