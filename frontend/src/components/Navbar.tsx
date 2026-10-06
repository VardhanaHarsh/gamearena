import { useMutation } from '@tanstack/react-query'
import { Gamepad2, LogOut, Menu, Moon, Shield, Sun, Volume2, VolumeX, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router'
import { api } from '../services/api'
import { disconnectSocket } from '../services/socket'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'
import { Avatar, Credits } from './ui'
import { NotificationBell } from './NotificationBell'

const links = [
  { to: '/lobby', label: 'Lobby' },
  { to: '/games', label: 'Games' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/history', label: 'History' },
  { to: '/wallet', label: 'Wallet' },
]

export function Navbar() {
  const user = useAuth((s) => s.user)
  const { theme, toggleTheme, sound, toggleSound } = useUi()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      disconnectSocket()
      useAuth.getState().clear()
      navigate('/')
    },
  })

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg'}`

  return (
    <header className="glass sticky top-[30px] z-40 border-x-0 border-t-0">
      <nav className="mx-auto flex h-16 short:h-11 max-w-7xl items-center gap-3 px-4 sm:px-6" aria-label="Main">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold tracking-wide">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-cyan text-white">
            <Gamepad2 className="size-5" />
          </span>
          GAME<span className="text-gradient">ARENA</span>
        </Link>

        {user && (
          <div className="ml-4 hidden items-center gap-1 lg:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className={linkClass}>
                {l.label}
              </NavLink>
            ))}
            {user.role === 'ADMIN' && (
              <NavLink to="/admin" className={linkClass}>
                <span className="inline-flex items-center gap-1">
                  <Shield className="size-3.5" /> Admin
                </span>
              </NavLink>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button onClick={toggleSound} aria-label={sound ? 'Mute sounds' : 'Unmute sounds'} className="rounded-xl p-2 text-muted hover:bg-surface-2 hover:text-fg">
            {sound ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
          </button>
          <button onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} className="rounded-xl p-2 text-muted hover:bg-surface-2 hover:text-fg">
            {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
          {user ? (
            <>
              <NotificationBell />
              <Link to="/wallet" className="hidden rounded-xl border border-line-2 px-3 py-1.5 sm:block" title="Virtual credits — no real value">
                <Credits amount={user.wallet.available} size="sm" />
              </Link>
              <Link to="/profile" className="ml-1 hidden items-center gap-2 rounded-xl p-1 pr-2 hover:bg-surface-2 sm:flex" aria-label="Your profile">
                <Avatar avatar={user.avatar} size={32} />
                <span className="hidden text-sm font-medium xl:inline">{user.displayName}</span>
              </Link>
              <button onClick={() => logout.mutate()} aria-label="Sign out" className="hidden rounded-xl p-2 text-muted hover:bg-surface-2 hover:text-fg sm:block">
                <LogOut className="size-5" />
              </button>
              <button onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open} className="rounded-xl p-2 text-fg hover:bg-surface-2 lg:hidden">
                {open ? <X className="size-5" /> : <Menu className="size-5" />}
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="rounded-xl px-3 py-2 text-sm font-medium text-muted hover:text-fg">
                Sign in
              </Link>
              <Link to="/register" className="rounded-xl bg-gradient-to-r from-primary to-primary-2 px-4 py-2 text-sm font-semibold text-white">
                Play now
              </Link>
            </>
          )}
        </div>
      </nav>

      <AnimatePresence>
        {open && user && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-line lg:hidden">
            <div className="grid gap-1 p-3">
              <div className="mb-2 flex items-center justify-between rounded-xl bg-surface px-3 py-2">
                <span className="flex items-center gap-2 text-sm">
                  <Avatar avatar={user.avatar} size={28} />
                  {user.displayName}
                </span>
                <Credits amount={user.wallet.available} size="sm" />
              </div>
              {[...links, { to: '/profile', label: 'Profile' }, { to: '/account', label: 'Account & Safety' }, ...(user.role === 'ADMIN' ? [{ to: '/admin', label: 'Admin' }] : [])].map((l) => (
                <NavLink key={l.to} to={l.to} onClick={() => setOpen(false)} className={linkClass}>
                  {l.label}
                </NavLink>
              ))}
              <button onClick={() => logout.mutate()} className="rounded-lg px-3 py-2 text-left text-sm text-danger">
                Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
