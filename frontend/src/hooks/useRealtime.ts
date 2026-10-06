import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { disconnectSocket, getSocket } from '../services/socket'
import { play } from '../services/sound'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'
import type { NotificationItem } from '../types/api'

/** Opens the authenticated socket while signed in and turns `notification:new` into toasts + cache refreshes. */
export function useRealtime() {
  const signedIn = useAuth((s) => !!s.accessToken)
  const qc = useQueryClient()
  useEffect(() => {
    if (!signedIn) {
      disconnectSocket()
      return
    }
    const socket = getSocket()
    const onNotification = (n: NotificationItem) => {
      play('notify')
      useUi.getState().toast({ kind: n.type.includes('LOST') || n.type.includes('DISCONNECT') ? 'info' : 'success', title: n.title, body: n.body })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
      if (['PRIZE_CREDITED', 'REFUND', 'GAME_WON', 'GAME_LOST', 'GAME_DRAW'].includes(n.type)) {
        void qc.invalidateQueries({ queryKey: ['wallet'] })
        void qc.invalidateQueries({ queryKey: ['me'] })
        void qc.invalidateQueries({ queryKey: ['history'] })
      }
    }
    socket.on('notification:new', onNotification)
    return () => {
      socket.off('notification:new', onNotification)
    }
  }, [signedIn, qc])
}
