-- GameArena initial schema
-- All balances are VIRTUAL CREDITS with no real-world value, stored as integer BIGINT.
-- There is no deposit, withdrawal or payment path: credits enter only via the one-time signup grant
-- and move only between entry fees and prizes. PostgreSQL is the source of truth; Redis is ephemeral.

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Users & auth
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          CITEXT NOT NULL UNIQUE,
  username       CITEXT NOT NULL UNIQUE CHECK (username ~ '^[A-Za-z0-9_]{3,20}$'),
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'PLAYER' CHECK (role IN ('PLAYER', 'ADMIN')),
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'SUSPENDED')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_profiles (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name   TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  avatar         TEXT NOT NULL DEFAULT 'falcon',
  phone          TEXT CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ]{7,20}$'),
  xp             INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Refresh tokens are stored hashed; rotation is tracked per family so token reuse revokes the whole family.
CREATE TABLE refresh_tokens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id      UUID NOT NULL,
  token_hash     TEXT NOT NULL UNIQUE,
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  replaced_by    UUID REFERENCES refresh_tokens(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(family_id);

CREATE TABLE password_reset_tokens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Responsible-gaming controls (prototype).
CREATE TABLE user_settings (
  user_id                  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  daily_spend_limit        BIGINT CHECK (daily_spend_limit IS NULL OR daily_spend_limit > 0),
  break_reminder_minutes   INTEGER NOT NULL DEFAULT 60 CHECK (break_reminder_minutes BETWEEN 5 AND 600),
  paused_until             TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Games, rooms, moves, results
-- ---------------------------------------------------------------------------
CREATE TABLE games (
  key              TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  min_players      SMALLINT NOT NULL CHECK (min_players >= 1),
  max_players      SMALLINT NOT NULL CHECK (max_players >= min_players),
  default_entry    BIGINT NOT NULL CHECK (default_entry >= 0),
  est_minutes      SMALLINT NOT NULL,
  enabled          BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE game_rooms (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT NOT NULL UNIQUE,
  game_key       TEXT NOT NULL REFERENCES games(key),
  host_id        UUID NOT NULL REFERENCES users(id),
  entry_fee      BIGINT NOT NULL CHECK (entry_fee >= 0),
  max_players    SMALLINT NOT NULL CHECK (max_players BETWEEN 1 AND 8),
  is_private     BOOLEAN NOT NULL DEFAULT false,
  is_practice    BOOLEAN NOT NULL DEFAULT false,
  status         TEXT NOT NULL DEFAULT 'WAITING'
                 CHECK (status IN ('WAITING', 'READY', 'STARTING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at     TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ,
  CHECK (NOT is_practice OR entry_fee = 0)
);
CREATE INDEX idx_rooms_status ON game_rooms(status, game_key);
CREATE INDEX idx_rooms_created ON game_rooms(created_at DESC);

CREATE TABLE game_players (
  room_id        UUID NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id),          -- NULL for practice bots
  bot_name       TEXT,
  seat           SMALLINT NOT NULL,
  is_ready       BOOLEAN NOT NULL DEFAULT false,
  status         TEXT NOT NULL DEFAULT 'JOINED' CHECK (status IN ('JOINED', 'FORFEITED')),
  entry_tx_id    UUID,                                -- ledger HOLD for this seat's entry fee (FK added below)
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, seat),
  CHECK ((user_id IS NULL) <> (bot_name IS NULL))
);
CREATE UNIQUE INDEX uq_game_players_user ON game_players(room_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_game_players_user ON game_players(user_id);

CREATE TABLE game_moves (
  id              BIGSERIAL PRIMARY KEY,
  room_id         UUID NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  user_id         UUID REFERENCES users(id),
  seat            SMALLINT NOT NULL,
  move            JSONB NOT NULL,
  client_move_id  UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, seq)
);
CREATE UNIQUE INDEX uq_game_moves_client ON game_moves(room_id, client_move_id) WHERE client_move_id IS NOT NULL;

-- One result per room: the UNIQUE(room_id) constraint is what makes settlement idempotent.
CREATE TABLE game_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL UNIQUE REFERENCES game_rooms(id),
  game_key        TEXT NOT NULL REFERENCES games(key),
  winner_user_id  UUID REFERENCES users(id),
  winner_seat     SMALLINT,
  outcome         TEXT NOT NULL CHECK (outcome IN ('WIN', 'DRAW', 'FORFEIT', 'CANCELLED')),
  prize_pool      BIGINT NOT NULL CHECK (prize_pool >= 0),
  final_state     JSONB NOT NULL,
  settled_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_results_settled ON game_results(settled_at DESC);

-- ---------------------------------------------------------------------------
-- Wallet & ledger
-- ---------------------------------------------------------------------------
-- `wallets` is a balance PROJECTION of the ledger, updated only inside the same DB transaction
-- that appends ledger lines. Invariant: available = SUM(available_delta), locked = SUM(locked_delta).
CREATE TABLE wallets (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  available      BIGINT NOT NULL DEFAULT 0 CHECK (available >= 0),
  locked         BIGINT NOT NULL DEFAULT 0 CHECK (locked >= 0),
  version        BIGINT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_transactions (
  transaction_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  game_id          UUID REFERENCES game_rooms(id),
  amount           BIGINT NOT NULL CHECK (amount > 0),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('SIGNUP_BONUS', 'ENTRY_FEE', 'PRIZE', 'REFUND')),
  -- HOLD: available -> locked (entry fee reserved), CAPTURE: locked -> prize pool,
  -- RELEASE: locked -> available (refund), CREDIT: -> available (signup grant, prize)
  entry_kind       TEXT NOT NULL CHECK (entry_kind IN ('CREDIT', 'HOLD', 'CAPTURE', 'RELEASE')),
  available_delta  BIGINT NOT NULL,
  locked_delta     BIGINT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED')),
  reference_id     UUID REFERENCES ledger_transactions(transaction_id),
  idempotency_key  TEXT NOT NULL UNIQUE,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (entry_kind = 'CREDIT'  AND available_delta =  amount AND locked_delta = 0) OR
    (entry_kind = 'HOLD'    AND available_delta = -amount AND locked_delta = amount) OR
    (entry_kind = 'CAPTURE' AND available_delta = 0       AND locked_delta = -amount) OR
    (entry_kind = 'RELEASE' AND available_delta =  amount AND locked_delta = -amount)
  )
);
CREATE INDEX idx_ledger_user_created ON ledger_transactions(user_id, created_at DESC);
CREATE INDEX idx_ledger_game ON ledger_transactions(game_id);
CREATE INDEX idx_ledger_type_created ON ledger_transactions(transaction_type, created_at);

-- The ledger is append-only: lines can never be edited or deleted.
CREATE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ledger_transactions is append-only';
  END IF;
  IF NEW.amount <> OLD.amount OR NEW.available_delta <> OLD.available_delta
     OR NEW.locked_delta <> OLD.locked_delta OR NEW.user_id <> OLD.user_id
     OR NEW.idempotency_key <> OLD.idempotency_key THEN
    RAISE EXCEPTION 'ledger amounts are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE game_players
  ADD CONSTRAINT fk_game_players_entry_tx FOREIGN KEY (entry_tx_id) REFERENCES ledger_transactions(transaction_id);

CREATE TRIGGER trg_ledger_append_only
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

-- ---------------------------------------------------------------------------
-- Leaderboard, notifications, audit, anti-cheat
-- ---------------------------------------------------------------------------
-- Running per-user, per-game totals, updated inside the settlement transaction.
CREATE TABLE leaderboards (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_key       TEXT NOT NULL REFERENCES games(key),
  games_played   INTEGER NOT NULL DEFAULT 0,
  wins           INTEGER NOT NULL DEFAULT 0,
  credits_won    BIGINT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_key)
);
CREATE INDEX idx_leaderboards_wins ON leaderboards(game_key, wins DESC);

CREATE TABLE notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  data           JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE audit_logs (
  id             BIGSERIAL PRIMARY KEY,
  actor_id       UUID REFERENCES users(id),
  action         TEXT NOT NULL,
  target_type    TEXT,
  target_id      TEXT,
  level          TEXT NOT NULL DEFAULT 'INFO' CHECK (level IN ('INFO', 'WARN', 'ERROR')),
  details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip             TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_action ON audit_logs(action);

CREATE TABLE anticheat_flags (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES users(id),
  room_id        UUID REFERENCES game_rooms(id),
  reason         TEXT NOT NULL,
  severity       TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_anticheat_user ON anticheat_flags(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
INSERT INTO games (key, name, min_players, max_players, default_entry, est_minutes, enabled) VALUES
  ('ludo',        'Ludo',          2, 4, 100, 20, true),
  ('carrom',      'Carrom',        2, 2,  50, 15, true),
  ('tictactoe',   'Tic-Tac-Toe',   2, 2,  20,  3, true),
  ('connectfour', 'Connect Four',  2, 2,  30,  8, true),
  ('chess',       'Chess',         2, 2, 100, 30, false),
  ('checkers',    'Checkers',      2, 2,  50, 15, false);
