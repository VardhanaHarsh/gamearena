import { useMutation, useQuery } from '@tanstack/react-query'
import { Clock, HeartHandshake, PauseCircle, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Avatar, Button, Card, Credits, Field, PageHeader, inputClass } from '../components/ui'
import { AVATARS } from '../lib/games'
import { api } from '../services/api'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'
import type { Me } from '../types/api'

export function Account() {
  const user = useAuth((s) => s.user)!
  const { theme, toggleTheme, sound, toggleSound } = useUi()
  const toast = useUi((s) => s.toast)
  const [profile, setProfile] = useState({ displayName: user.displayName, avatar: user.avatar, phone: user.phone ?? '' })
  const [limit, setLimit] = useState<string>(user.settings.dailySpendLimit?.toString() ?? '')
  const [reminder, setReminder] = useState(user.settings.breakReminderMinutes)
  const [pauseHours, setPauseHours] = useState(24)
  const { data: stats } = useQuery({ queryKey: ['me', 'stats'], queryFn: () => api<{ spentToday: number }>('/users/me/stats') })
  const onUser = (title: string) => (res: { user: Me }) => {
    useAuth.getState().setUser(res.user)
    toast({ kind: 'success', title })
  }
  const onError = (e: Error) => toast({ kind: 'error', title: e.message })
  const saveProfile = useMutation({ mutationFn: () => api<{ user: Me }>('/users/me', { method: 'PATCH', body: { ...profile, phone: profile.phone || null } }), onSuccess: onUser('Profile saved'), onError })
  const saveRg = useMutation({ mutationFn: () => api<{ user: Me }>('/users/me/settings', { method: 'PATCH', body: { dailySpendLimit: limit ? Number(limit) : null, breakReminderMinutes: reminder } }), onSuccess: onUser('Limits updated'), onError })
  const pause = useMutation({ mutationFn: () => api<{ user: Me }>('/users/me/pause', { method: 'POST', body: { hours: pauseHours } }), onSuccess: onUser('Account paused'), onError })
  const paused = user.settings.pausedUntil && new Date(user.settings.pausedUntil) > new Date()

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader eyebrow="Account" title="Account & safety" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-6">
          <h2 className="font-display text-lg font-semibold">Profile</h2>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Avatar">
            {AVATARS.map((a) => (
              <button key={a} role="radio" aria-checked={profile.avatar === a} onClick={() => setProfile({ ...profile, avatar: a })} className={`rounded-full p-0.5 ${profile.avatar === a ? 'ring-2 ring-primary-2' : ''}`}>
                <Avatar avatar={a} size={40} />
              </button>
            ))}
          </div>
          <Field label="Display name"><input className={inputClass} value={profile.displayName} maxLength={40} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} /></Field>
          <Field label="Phone (optional)" hint="Only visible to you"><input className={inputClass} value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></Field>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-xs text-subtle">Username</dt><dd>@{user.username}</dd></div>
            <div><dt className="text-xs text-subtle">Email</dt><dd className="truncate">{user.email}</dd></div>
            <div><dt className="text-xs text-subtle">Account status</dt><dd>{paused ? 'PAUSED' : user.status}</dd></div>
            <div><dt className="text-xs text-subtle">Role</dt><dd>{user.role}</dd></div>
          </dl>
          <Button loading={saveProfile.isPending} onClick={() => saveProfile.mutate()}>Save profile</Button>
        </Card>

        <Card className="space-y-4 p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold"><ShieldCheck className="size-5 text-success" />Responsible gaming</h2>
          <p className="rounded-xl bg-gold/10 px-3 py-2 text-xs text-gold">Prototype controls. Limits are enforced by the server when you join paid rooms.</p>
          <Field label="Daily virtual spending limit (entry fees)" hint={`Spent today: ${stats?.spentToday ?? 0} VC. Leave empty for no limit.`}>
            <input className={inputClass} type="number" min={10} placeholder="No limit" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Field>
          <Field label="Break reminder every (minutes)">
            <input className={inputClass} type="number" min={5} max={600} value={reminder} onChange={(e) => setReminder(Number(e.target.value))} />
          </Field>
          <Button loading={saveRg.isPending} onClick={() => saveRg.mutate()} icon={<Clock className="size-4" />}>Save limits</Button>
          <div className="border-t border-line pt-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium"><PauseCircle className="size-4" />Pause account</p>
            {paused ? (
              <p className="text-sm text-muted">Paused until {new Date(user.settings.pausedUntil!).toLocaleString()}. You can browse but can't join paid games.</p>
            ) : (
              <div className="flex gap-2">
                <select value={pauseHours} onChange={(e) => setPauseHours(Number(e.target.value))} className={`${inputClass} w-40`} aria-label="Pause duration">
                  <option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>7 days</option><option value={720}>30 days</option>
                </select>
                <Button variant="danger" loading={pause.isPending} onClick={() => pause.mutate()}>Pause</Button>
              </div>
            )}
          </div>
          <Link to="/responsible-gaming" className="inline-flex items-center gap-1.5 text-sm text-primary-2 hover:underline"><HeartHandshake className="size-4" />About these controls</Link>
        </Card>

        <Card className="space-y-3 p-6">
          <h2 className="font-display text-lg font-semibold">Preferences</h2>
          <label className="flex items-center justify-between text-sm">Dark mode <input type="checkbox" checked={theme === 'dark'} onChange={toggleTheme} className="size-5 accent-[var(--primary)]" /></label>
          <label className="flex items-center justify-between text-sm">Sound effects <input type="checkbox" checked={sound} onChange={toggleSound} className="size-5 accent-[var(--primary)]" /></label>
        </Card>

        <Card className="space-y-2 p-6">
          <h2 className="font-display text-lg font-semibold">Wallet</h2>
          <Credits amount={user.wallet.available} size="lg" />
          <p className="text-sm text-muted">Virtual credits only. There are no deposits, purchases or withdrawals in GameArena.</p>
        </Card>
      </div>
    </div>
  )
}

export function ResponsibleGaming() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Player wellbeing" title="Responsible gaming" description="GameArena uses virtual credits only, but healthy play habits still matter. These are prototype controls." />
      <div className="space-y-4 text-sm text-muted">
        {[
          ['⏱ Session timer', 'Your current session length is shown in the footer while signed in.'],
          ['🔔 Break reminders', 'Get a reminder after a configurable number of minutes of play.'],
          ['🪙 Daily virtual spending limit', 'Cap how many virtual credits you can commit to entry fees per day. Enforced server-side.'],
          ['⏸ Account pause', 'Take a break for 1–30 days. While paused you cannot join paid rooms, and the pause cannot be shortened.'],
          ['📜 Game history', 'Review every game, move and credit movement in History and Wallet.'],
        ].map(([t, b]) => (
          <div key={t} className="card p-5"><p className="font-display text-base font-semibold text-fg">{t}</p><p className="mt-1">{b}</p></div>
        ))}
        <p className="rounded-xl border border-gold/30 bg-gold/10 p-4 text-xs text-gold">
          GameArena is a portfolio prototype. Credits have no monetary value, cannot be purchased, and cannot be exchanged for money or prizes.
        </p>
      </div>
    </div>
  )
}

export function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="font-display text-8xl font-bold text-gradient">404</p>
      <p className="mt-4 text-muted">This page left the game.</p>
      <Link to="/" className="mt-6 inline-block text-primary-2">Back home</Link>
    </div>
  )
}
