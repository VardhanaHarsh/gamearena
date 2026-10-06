import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { Spinner } from './components/ui'
import { api, ApiError, refreshSession } from './services/api'
import { useAuth } from './store/auth'
import './index.css'
import type { Me } from './types/api'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
})

/** Restores the session from the httpOnly refresh cookie, and keeps `user` (incl. wallet) fresh. */
function Bootstrap() {
  const { bootstrapped, setBootstrapped, accessToken } = useAuth()
  useEffect(() => {
    void refreshSession().finally(setBootstrapped)
  }, [setBootstrapped])
  useEffect(() => {
    if (!accessToken) return
    // Re-sync the profile/wallet whenever a 'me' query is invalidated (prizes, refunds, entry fees).
    return queryClient.getQueryCache().subscribe((e) => {
      if (e.type === 'updated' && e.query.queryKey[0] === 'me' && e.action.type === 'invalidate') {
        void api<{ user: Me }>('/auth/me').then((r) => useAuth.getState().setUser(r.user)).catch(() => {})
      }
    })
  }, [accessToken])
  return bootstrapped ? <App /> : <Spinner label="Loading GameArena" />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <Bootstrap />
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
)
