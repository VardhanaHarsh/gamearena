import { AnimatePresence, motion } from 'motion/react'
import { WifiOff } from 'lucide-react'
import { Link, Outlet, useLocation } from 'react-router'
import { useRealtime } from '../hooks/useRealtime'
import { useSessionTimer } from '../hooks/useSessionTimer'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'
import { DemoBanner } from './DemoBanner'
import { DevTools } from './DevTools'
import { Navbar } from './Navbar'
import { Toaster } from './Toaster'

export function Layout() {
  const location = useLocation()
  const user = useAuth((s) => s.user)
  const connection = useUi((s) => s.connection)
  useRealtime()
  const sessionMinutes = useSessionTimer()

  return (
    <div className="flex min-h-dvh flex-col">
      <DemoBanner />
      <Navbar />
      <AnimatePresence>
        {user && connection === 'disconnected' && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden bg-danger/15 text-danger" role="status">
            <p className="flex items-center justify-center gap-2 py-1.5 text-xs font-medium">
              <WifiOff className="size-3.5" /> Connection lost. Reconnecting…
            </p>
          </motion.div>
        )}
      </AnimatePresence>
      <main className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>GameArena — portfolio prototype. Virtual credits only: they cannot be bought, sold, transferred or withdrawn.</p>
          <p className="flex gap-3">
            {user && <span>Session: {sessionMinutes} min</span>}
            <Link to="/responsible-gaming" className="hover:text-fg">
              Responsible gaming
            </Link>
          </p>
        </div>
      </footer>
      <Toaster />
      {import.meta.env.DEV && <DevTools />}
    </div>
  )
}
