import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'dark' | 'light'

interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  title: string
  body?: string
}

interface UiState {
  theme: Theme
  sound: boolean
  devTools: boolean
  toasts: Toast[]
  connection: 'connected' | 'connecting' | 'disconnected'
  toggleTheme: () => void
  toggleSound: () => void
  toggleDevTools: () => void
  toast: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
  setConnection: (c: UiState['connection']) => void
}

let nextId = 1

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      sound: true,
      devTools: false,
      toasts: [],
      connection: 'connecting',
      toggleTheme: () => {
        const theme = get().theme === 'dark' ? 'light' : 'dark'
        document.documentElement.classList.toggle('light', theme === 'light')
        document.documentElement.classList.toggle('dark', theme === 'dark')
        try {
          localStorage.setItem('ga-theme', theme)
        } catch {
          /* ignore */
        }
        set({ theme })
      },
      toggleSound: () => set({ sound: !get().sound }),
      toggleDevTools: () => set({ devTools: !get().devTools }),
      toast: (t) => {
        const id = nextId++
        set({ toasts: [...get().toasts.slice(-3), { ...t, id }] })
        setTimeout(() => get().dismiss(id), 5000)
      },
      dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
      setConnection: (connection) => set({ connection }),
    }),
    { name: 'ga-ui', partialize: (s) => ({ theme: s.theme, sound: s.sound, devTools: s.devTools }) },
  ),
)
