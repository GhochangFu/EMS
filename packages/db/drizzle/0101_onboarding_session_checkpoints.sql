-- F3.25 / ADR 0094 decision 2 — draft checkpoints for the onboarding chat.
--
-- `bms.onboarding_sessions.checkpoints` holds the ring of the last 10 draft
-- checkpoints, each taken before a chat turn that changed the draft. Nullable
-- with no default: NULL is an empty ring, and every existing row stays valid.
--
-- NO POLICY OR PRIVILEGE CHANGE. The table's row level security (0040/0041)
-- is table-level and already gates the new column; the pool roles reach it
-- through the existing table privileges. The column is never mapped into an
-- API response.
SET ROLE bms_owner;

ALTER TABLE bms.onboarding_sessions ADD COLUMN IF NOT EXISTS checkpoints jsonb;

COMMENT ON COLUMN bms.onboarding_sessions.checkpoints IS 'ADR 0094: ring of at most 10 draft checkpoints taken before a chat turn; never returned to a client';

RESET ROLE;
