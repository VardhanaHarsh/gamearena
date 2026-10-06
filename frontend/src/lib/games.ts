export const GAME_STYLE: Record<string, { emoji: string; from: string; to: string }> = {
  ludo: { emoji: '🎲', from: '#ef4444', to: '#f59e0b' },
  carrom: { emoji: '🎯', from: '#d97706', to: '#78350f' },
  chess: { emoji: '♟️', from: '#64748b', to: '#1e293b' },
  tictactoe: { emoji: '⭕', from: '#8b5cf6', to: '#22d3ee' },
  checkers: { emoji: '🔴', from: '#dc2626', to: '#111827' },
  connectfour: { emoji: '🟡', from: '#facc15', to: '#2563eb' },
}
export const gameStyle = (key: string) => GAME_STYLE[key] ?? { emoji: '🎮', from: '#8b5cf6', to: '#22d3ee' }

export const AVATAR_EMOJI: Record<string, string> = {
  falcon: '🦅', tiger: '🐯', wolf: '🐺', fox: '🦊', owl: '🦉', shark: '🦈', dragon: '🐉', panda: '🐼', eagle: '🦅', lion: '🦁', robot: '🤖',
}
export const AVATARS = ['falcon', 'tiger', 'wolf', 'fox', 'owl', 'shark', 'dragon', 'panda', 'eagle', 'lion'] as const
