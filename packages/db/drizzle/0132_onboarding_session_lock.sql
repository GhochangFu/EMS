-- F4.339 / ADR 0117 decision 9 — a global administrator can lock a draft.
--
--   - `bms.onboarding_sessions.locked_at` (timestamptz), `locked_by` (uuid) and
--     `lock_reason` (varchar(500)): all three nullable with no default; NULL is
--     "not locked". The API writes them together (lock) and clears them
--     together (unlock); a locked draft refuses every write and stays readable.
--   - `locked_by` is a plain uuid with no foreign key (plan R12, ruling Q7):
--     the session DTO joins `bms.users` for a display name at read, and a lock
--     outlives nothing it would need to cascade.
--   - No backfill: every existing session starts unlocked.
--
-- POLICY. None: the table-level RLS of 0040/0041 covers new columns, and a
-- column changes no grant.
--
-- ROLE AND GRANTS. Run as bms_owner inside SET ROLE / RESET ROLE, the table's
-- owner, as 0101 did for `checkpoints`. No GRANT.
--
-- Forward-only. Idempotent: every column is `IF NOT EXISTS`.

SET ROLE bms_owner;

ALTER TABLE bms.onboarding_sessions ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE bms.onboarding_sessions ADD COLUMN IF NOT EXISTS locked_by uuid;
ALTER TABLE bms.onboarding_sessions ADD COLUMN IF NOT EXISTS lock_reason varchar(500);

RESET ROLE;
