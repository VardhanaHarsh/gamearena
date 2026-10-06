import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router'
import { Layout } from './components/Layout'
import { Spinner } from './components/ui'
import { Account, NotFound, ResponsibleGaming } from './pages/Account'
import { ForgotPassword, Login, Register, ResetPassword } from './pages/Auth'
import { GameDetail, GamesList } from './pages/Games'
import { Landing } from './pages/Landing'
import { Lobby } from './pages/Lobby'
import { useAuth } from './store/auth'

// Heavier, less-visited pages are code-split.
const Room = lazy(() => import('./pages/Room').then((m) => ({ default: m.Room })))
const Wallet = lazy(() => import('./pages/Wallet').then((m) => ({ default: m.Wallet })))
const History = lazy(() => import('./pages/History').then((m) => ({ default: m.History })))
const Leaderboard = lazy(() => import('./pages/Leaderboard').then((m) => ({ default: m.Leaderboard })))
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })))
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })))

function Protected({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const user = useAuth((s) => s.user)
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (admin && user.role !== 'ADMIN') return <Navigate to="/lobby" replace />
  return <Suspense fallback={<Spinner />}>{children}</Suspense>
}

function GuestOnly({ children }: { children: ReactNode }) {
  return useAuth((s) => s.user) ? <Navigate to="/lobby" replace /> : <>{children}</>
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/login', element: <GuestOnly><Login /></GuestOnly> },
      { path: '/register', element: <GuestOnly><Register /></GuestOnly> },
      { path: '/forgot-password', element: <ForgotPassword /> },
      { path: '/reset-password', element: <ResetPassword /> },
      { path: '/responsible-gaming', element: <ResponsibleGaming /> },
      { path: '/lobby', element: <Protected><Lobby /></Protected> },
      { path: '/games', element: <Protected><GamesList /></Protected> },
      { path: '/games/:key', element: <Protected><GameDetail /></Protected> },
      { path: '/room/:id', element: <Protected><Room /></Protected> },
      { path: '/wallet', element: <Protected><Wallet /></Protected> },
      { path: '/history', element: <Protected><History /></Protected> },
      { path: '/leaderboard', element: <Protected><Leaderboard /></Protected> },
      { path: '/profile', element: <Protected><Profile /></Protected> },
      { path: '/players/:username', element: <Protected><Profile /></Protected> },
      { path: '/account', element: <Protected><Account /></Protected> },
      { path: '/admin', element: <Protected admin><Admin /></Protected> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
