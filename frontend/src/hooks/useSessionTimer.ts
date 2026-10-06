import { useEffect, useState } from 'react'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'

const KEY = 'ga-session-start'

/** Responsible-gaming session timer with a break reminder (prototype — client-side only). */
export function useSessionTimer() {
  const user = useAuth((s) => s.user)
  const [start] = useState(() => {
    const saved = Number(sessionStorage.getItem(KEY))
    const value = saved || Date.now()
    sessionStorage.setItem(KEY, String(value))
    return value
  })
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const minutes = Math.floor((now - start) / 60_000)
  const every = user?.settings.breakReminderMinutes ?? 60
  useEffect(() => {
    if (user && minutes > 0 && minutes % every === 0) {
      useUi.getState().toast({ kind: 'info', title: 'Time for a break?', body: `You've been playing for ${minutes} minutes.` })
    }
  }, [minutes, every, user])
  return minutes
}
