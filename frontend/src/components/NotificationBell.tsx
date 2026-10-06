import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { timeAgo } from '../lib/format'
import { api } from '../services/api'
import type { NotificationItem } from '../types/api'

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ items: NotificationItem[]; unread: number }>('/notifications'), refetchInterval: 60_000 })
  const markAll = useMutation({ mutationFn: () => api('/notifications/read', { method: 'POST', body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) })

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const unread = data?.unread ?? 0
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-label={`Notifications (${unread} unread)`} aria-expanded={open} className="relative rounded-xl p-2 text-muted transition hover:bg-surface-2 hover:text-fg">
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            className="glass fixed inset-x-3 top-[104px] z-50 max-h-[70vh] overflow-y-auto rounded-2xl shadow-2xl sm:absolute sm:inset-x-auto sm:top-12 sm:right-0 sm:w-96"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-display font-semibold">Notifications</p>
              {unread > 0 && (
                <button onClick={() => markAll.mutate()} className="text-xs text-primary-2 hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            <ul>
              {data?.items.length ? (
                data.items.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => {
                        setOpen(false)
                        if (typeof n.data.roomId === 'string') navigate(`/room/${n.data.roomId}`)
                      }}
                      className={`flex w-full gap-3 border-b border-line px-4 py-3 text-left transition hover:bg-surface ${n.read_at ? 'opacity-70' : ''}`}
                    >
                      {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary-2" />}
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{n.title}</span>
                        <span className="block text-xs text-muted">{n.body}</span>
                        <span className="mt-0.5 block text-[10px] text-subtle">{timeAgo(n.created_at)}</span>
                      </span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-4 py-8 text-center text-sm text-subtle">You're all caught up.</li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
