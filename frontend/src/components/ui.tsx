import { motion } from 'motion/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { AVATAR_EMOJI } from '../lib/games'
import { credits } from '../lib/format'
import { play } from '../services/sound'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold'
const variants: Record<Variant, string> = {
  primary: 'bg-gradient-to-r from-primary to-primary-2 text-white shadow-[0_8px_30px_-10px_var(--primary)] hover:brightness-110',
  secondary: 'border border-line-2 bg-surface text-fg hover:bg-surface-2 hover:border-primary-2/60',
  ghost: 'text-muted hover:text-fg hover:bg-surface',
  danger: 'bg-danger/90 text-white hover:bg-danger',
  gold: 'bg-gradient-to-r from-amber-400 to-orange-500 text-black font-semibold hover:brightness-110',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'primary', size = 'md', loading, icon, children, className = '', onClick, disabled, ...rest }: ButtonProps) {
  const sizing = size === 'sm' ? 'h-8 px-3 text-xs' : size === 'lg' ? 'h-12 px-6 text-base' : 'h-10 px-4 text-sm'
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      onClick={(e) => {
        play('click')
        onClick?.(e)
      }}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium whitespace-nowrap transition active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 ${sizing} ${variants[variant]} ${className}`}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>
}

export function Avatar({ avatar, size = 40, ring }: { avatar: string; size?: number; ring?: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-line-2 bg-surface-2"
      style={{ width: size, height: size, fontSize: size * 0.52, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }}
      aria-hidden
    >
      {AVATAR_EMOJI[avatar] ?? '🎮'}
    </span>
  )
}

/** Every amount in the UI is explicitly labelled as virtual credits. */
export function Credits({ amount, className = '', size = 'md' }: { amount: number; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const text = size === 'lg' ? 'text-3xl sm:text-4xl' : size === 'sm' ? 'text-sm' : 'text-base'
  return (
    <span className={`inline-flex items-baseline gap-1 font-display font-semibold text-gold ${text} ${className}`}>
      <span aria-hidden>🪙</span>
      {credits(amount)}
      <span className="font-sans text-[0.6em] font-medium tracking-wide text-subtle uppercase">VC</span>
      <span className="sr-only">virtual credits</span>
    </span>
  )
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'success' | 'warn' | 'danger' | 'primary' }) {
  const tones = {
    default: 'border-line-2 text-muted',
    success: 'border-success/40 bg-success/10 text-success',
    warn: 'border-gold/40 bg-gold/10 text-gold',
    danger: 'border-danger/40 bg-danger/10 text-danger',
    primary: 'border-primary-2/40 bg-primary/10 text-primary-2',
  }
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase ${tones[tone]}`}>{children}</span>
}

export const statusTone = (s: string) =>
  s === 'IN_PROGRESS' || s === 'COMPLETED' || s === 'WON' ? 'success' : s === 'WAITING' || s === 'READY' || s === 'STARTING' ? 'warn' : s === 'CANCELLED' || s === 'LOST' ? 'danger' : 'default'

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-muted" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}…</span>
    </div>
  )
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-2 px-6 py-12 text-center">
      <span className="text-4xl" aria-hidden>{icon}</span>
      <p className="font-display text-lg font-semibold">{title}</p>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action}
    </div>
  )
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-2 font-mono text-xs tracking-[0.2em] text-primary-2 uppercase">{eyebrow}</p>}
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </motion.header>
  )
}

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode }) {
  return (
    <div className="card p-4 sm:p-5">
      <p className="flex items-center gap-2 text-xs text-muted">
        {icon}
        {label}
      </p>
      <div className="mt-2 font-display text-2xl font-semibold">{value}</div>
      {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
    </div>
  )
}

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-fg">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-subtle">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  )
}

export const inputClass =
  'h-11 w-full rounded-xl border border-line-2 bg-bg-2/60 px-3.5 text-sm text-fg placeholder:text-subtle outline-none transition focus:border-primary-2 focus:ring-2 focus:ring-primary/30'
