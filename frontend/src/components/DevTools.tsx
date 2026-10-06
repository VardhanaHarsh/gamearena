import { FlaskConical } from 'lucide-react'
import { useNavigate } from 'react-router'
import { api } from '../services/api'
import { disconnectSocket } from '../services/socket'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'
import type { Me } from '../types/api'

const DEMO_ACCOUNTS = [
  ['player_one', 'Player One'],
  ['player_two', 'Player Two'],
  ['player_three', 'Player Three'],
  ['player_four', 'Player Four'],
] as const

/**
 * Development-only "Demo tools" toggle (never included in production builds): quick-switch between
 * seeded demo players to test multiplayer from several browser windows.
 */
export function DevTools() {
  const { devTools, toggleDevTools, toast } = useUi()
  const navigate = useNavigate()
  const login = async (identifier: string, password: string) => {
    try {
      disconnectSocket()
      const res = await api<{ accessToken: string; user: Me }>('/auth/login', { method: 'POST', body: { identifier, password }, auth: false })
      useAuth.getState().setSession(res.accessToken, res.user)
      toast({ kind: 'success', title: `Signed in as ${res.user.displayName}` })
      navigate('/lobby')
    } catch (e) {
      toast({ kind: 'error', title: 'Demo login failed', body: (e as Error).message })
    }
  }
  return (
    <div className="fixed bottom-3 left-3 z-[75]">
      {devTools && (
        <div className="glass mb-2 w-60 rounded-2xl p-3 text-xs shadow-2xl">
          <p className="mb-2 font-mono text-[10px] tracking-widest text-gold uppercase">Demo tools · dev only</p>
          <div className="grid gap-1">
            {DEMO_ACCOUNTS.map(([u, name]) => (
              <button key={u} onClick={() => login(u, 'Password123!')} className="rounded-lg border border-line px-2 py-1.5 text-left hover:border-primary-2">
                Sign in as {name}
              </button>
            ))}
            <button onClick={() => login('arena_admin', 'AdminPass123!')} className="rounded-lg border border-line px-2 py-1.5 text-left hover:border-primary-2">
              Sign in as Admin
            </button>
          </div>
        </div>
      )}
      <button onClick={toggleDevTools} aria-pressed={devTools} className="glass flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[10px] tracking-wider text-gold uppercase shadow-lg">
        <FlaskConical className="size-3.5" /><span className="hidden sm:inline">Demo tools {devTools ? "on" : "off"}</span>
      </button>
    </div>
  )
}
