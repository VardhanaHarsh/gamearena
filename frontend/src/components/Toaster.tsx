import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { useUi } from '../store/ui'

export function Toaster() {
  const { toasts, dismiss } = useUi()
  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-[80] flex w-[min(92vw,360px)] flex-col gap-2 sm:right-5 sm:bottom-5" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? XCircle : Info
          return (
            <motion.button
              layout
              key={t.id}
              onClick={() => dismiss(t.id)}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              className="glass pointer-events-auto flex gap-3 rounded-xl p-3 text-left shadow-xl"
            >
              <Icon className={`mt-0.5 size-5 shrink-0 ${t.kind === 'success' ? 'text-success' : t.kind === 'error' ? 'text-danger' : 'text-primary-2'}`} />
              <span>
                <span className="block text-sm font-semibold">{t.title}</span>
                {t.body && <span className="block text-xs text-muted">{t.body}</span>}
              </span>
            </motion.button>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
