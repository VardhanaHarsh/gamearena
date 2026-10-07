-- Checkers now has an engine (backend/src/modules/games/engines/checkers.engine.ts).
INSERT INTO games (key, name, min_players, max_players, default_entry, est_minutes)
VALUES ('checkers', 'Checkers', 2, 2, 50, 15)
ON CONFLICT (key) DO UPDATE SET enabled = true;
