export type Role = 'PLAYER' | 'ADMIN'
export type RoomStatus = 'WAITING' | 'READY' | 'STARTING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export interface Level {
  level: number
  xp: number
  progress: number
  nextLevelXp: number
}

export interface Me {
  id: string
  email: string
  username: string
  role: Role
  status: 'ACTIVE' | 'PAUSED' | 'SUSPENDED'
  createdAt: string
  displayName: string
  avatar: string
  phone: string | null
  level: Level
  settings: { dailySpendLimit: number | null; breakReminderMinutes: number; pausedUntil: string | null }
  wallet: { available: number; locked: number }
}

export interface GameInfo {
  key: string
  name: string
  tagline: string
  available: boolean
  minPlayers?: number
  maxPlayers?: number
  estMinutes?: number
  rules?: string[]
  prizeStructure?: string
  defaultEntry?: number
  playersOnline?: number
  openRooms?: number
}

export interface LobbyRoom {
  id: string
  code: string
  game_key: string
  entry_fee: number
  max_players: number
  players: number
  status: RoomStatus
  host_name: string
  prize_pool: number
  created_at: string
}

export interface Seat {
  seat: number
  userId: string | null
  username: string | null
  displayName: string
  avatar: string
  isBot: boolean
  isReady: boolean
  status: 'JOINED' | 'FORFEITED'
  connected: boolean
}

export interface RoomView {
  id: string
  code: string
  gameKey: string
  gameName: string
  hostId: string
  entryFee: number
  maxPlayers: number
  minPlayers: number
  prizePool: number
  isPrivate: boolean
  isPractice: boolean
  status: RoomStatus
  countdownEndsAt: number | null
  seats: Seat[]
  result: { outcome: 'WIN' | 'DRAW' | 'FORFEIT'; winnerSeat: number | null; prizePool: number; payouts: { userId: string; seat: number; amount: number }[] } | null
}

export interface GameEventItem {
  type: string
  seat?: number
  [k: string]: unknown
}

export interface GameView<S = unknown> {
  roomId: string
  gameKey: string
  seq: number
  state: S & { events: GameEventItem[]; forfeited: number[]; players: { seat: number; name: string; isBot: boolean; userId: string | null }[] }
  currentSeat: number | null
  turnDeadline: number | null
  serverTime: number
}

export interface WalletSummary {
  available: number
  locked: number
  winnings: number
  total_games: number
  total_wins: number
  signupBonus: number
  notice: string
}

export interface LedgerTx {
  transaction_id: string
  game_id: string | null
  amount: number
  transaction_type: 'SIGNUP_BONUS' | 'ENTRY_FEE' | 'PRIZE' | 'REFUND'
  entry_kind: 'CREDIT' | 'HOLD' | 'CAPTURE' | 'RELEASE'
  available_delta: number
  locked_delta: number
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED'
  idempotency_key: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown>
  read_at: string | null
  created_at: string
}

export interface LeaderboardEntry {
  rank: number
  user_id: string
  username: string
  display_name: string
  avatar: string
  games: number
  wins: number
  winRate: number
  credits_won: number
}
