-- Chess now has an engine (backend/src/modules/games/engines/chess.engine.ts).
INSERT INTO games (key, name, min_players, max_players, default_entry, est_minutes)
VALUES ('chess', 'Chess', 2, 2, 100, 30)
ON CONFLICT (key) DO UPDATE SET enabled = true;
