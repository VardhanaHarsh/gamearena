import { useMutation } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { Button, Field, inputClass } from '../components/ui'
import { api, ApiError } from '../services/api'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'
import type { Me } from '../types/api'

function AuthCard({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-20">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-3xl p-6 shadow-2xl sm:p-8">
        <h1 className="font-display text-3xl font-bold">{title}</h1>
        <p className="mt-1 mb-6 text-sm text-muted">{subtitle}</p>
        {children}
      </motion.div>
    </div>
  )
}

const fieldErrors = (err: unknown) => {
  const out: Record<string, string> = {}
  if (err instanceof ApiError && Array.isArray(err.details)) for (const d of err.details as { path: string; message: string }[]) out[d.path] = d.message
  return out
}

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ identifier: '', password: '' })
  const login = useMutation({
    mutationFn: () => api<{ accessToken: string; user: Me }>('/auth/login', { method: 'POST', body: form, auth: false }),
    onSuccess: (res) => {
      useAuth.getState().setSession(res.accessToken, res.user)
      navigate((location.state as { from?: string })?.from ?? '/lobby', { replace: true })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate()
  }
  return (
    <AuthCard title="Welcome back" subtitle={<>New here? <Link to="/register" className="text-primary-2 hover:underline">Create an account</Link> and get 1,000 virtual credits.</>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email or username">
          <input className={inputClass} autoComplete="username" required value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} />
        </Field>
        <Field label="Password">
          <input className={inputClass} type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {login.error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{login.error.message}</p>}
        <Button type="submit" className="w-full" size="lg" loading={login.isPending}>
          Sign in
        </Button>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="text-muted hover:text-fg">Forgot password?</Link>
        </p>
      </form>
    </AuthCard>
  )
}

export function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', username: '', displayName: '', password: '' })
  const register = useMutation({
    mutationFn: () => api<{ accessToken: string; user: Me }>('/auth/register', { method: 'POST', body: form, auth: false }),
    onSuccess: (res) => {
      useAuth.getState().setSession(res.accessToken, res.user)
      useUi.getState().toast({ kind: 'success', title: 'Welcome to GameArena!', body: '1,000 virtual credits have been added to your wallet.' })
      navigate('/lobby', { replace: true })
    },
  })
  const errors = fieldErrors(register.error)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })
  return (
    <AuthCard title="Create your account" subtitle={<>Already playing? <Link to="/login" className="text-primary-2 hover:underline">Sign in</Link></>}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          register.mutate()
        }}
        className="space-y-4"
      >
        <Field label="Email" error={errors.email}>
          <input className={inputClass} type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Username" error={errors.username} hint="3–20 letters, numbers, _">
            <input className={inputClass} autoComplete="username" required pattern="[A-Za-z0-9_]{3,20}" value={form.username} onChange={set('username')} />
          </Field>
          <Field label="Display name" error={errors.displayName}>
            <input className={inputClass} required maxLength={40} value={form.displayName} onChange={set('displayName')} />
          </Field>
        </div>
        <Field label="Password" error={errors.password} hint="8+ characters with a letter and a number">
          <input className={inputClass} type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set('password')} />
        </Field>
        <div className="rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold">
          🪙 You'll receive <strong>1,000 virtual credits</strong> to play with. Virtual credits have no real-world value and cannot be bought, sold or withdrawn.
        </div>
        {register.error && !Object.keys(errors).length && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{register.error.message}</p>}
        <Button type="submit" className="w-full" size="lg" loading={register.isPending}>
          Create account
        </Button>
      </form>
    </AuthCard>
  )
}

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const forgot = useMutation({ mutationFn: () => api<{ message: string; devResetUrl?: string }>('/auth/forgot-password', { method: 'POST', body: { email }, auth: false }) })
  return (
    <AuthCard title="Reset password" subtitle="We'll send a reset link to your email.">
      {forgot.data ? (
        <div className="space-y-3 text-sm">
          <p className="rounded-lg bg-success/10 px-3 py-2 text-success">{forgot.data.message}</p>
          {forgot.data.devResetUrl && (
            <p className="rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold">
              Demo: no email service is connected, so the link is shown here (development builds only):{' '}
              <a className="break-all underline" href={forgot.data.devResetUrl.replace(/^https?:\/\/[^/]+/, '')}>Open reset link</a>
            </p>
          )}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            forgot.mutate()
          }}
          className="space-y-4"
        >
          <Field label="Email">
            <input className={inputClass} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {forgot.error && <p className="text-sm text-danger">{forgot.error.message}</p>}
          <Button type="submit" className="w-full" loading={forgot.isPending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  )
}

export function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const reset = useMutation({
    mutationFn: () => api('/auth/reset-password', { method: 'POST', body: { token: params.get('token') ?? '', password }, auth: false }),
    onSuccess: () => {
      useUi.getState().toast({ kind: 'success', title: 'Password updated', body: 'Please sign in with your new password.' })
      navigate('/login')
    },
  })
  return (
    <AuthCard title="Choose a new password" subtitle="All other sessions will be signed out.">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          reset.mutate()
        }}
        className="space-y-4"
      >
        <Field label="New password" error={fieldErrors(reset.error).password} hint="8+ characters with a letter and a number">
          <input className={inputClass} type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {reset.error && <p className="text-sm text-danger">{reset.error.message}</p>}
        <Button type="submit" className="w-full" loading={reset.isPending}>
          Update password
        </Button>
      </form>
    </AuthCard>
  )
}
