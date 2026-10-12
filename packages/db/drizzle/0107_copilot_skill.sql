-- F3.86 PR 5 / ADR 0099 decision 7 — the onboarding skill: a copilot
-- conversation may be bound to one onboarding session.
--
--   - `bms.copilot_conversations.onboarding_session_id`: the draft session the
--     conversation's turns run (`OnboardingService.chat`). Null for every other
--     conversation. `ON DELETE SET NULL`: a session removed with its
--     organization leaves the conversation as a plain one, never a dangling id.
--   - A partial index on the bound rows, for the lookups from a session.
--
-- POLICY. Unchanged: the column is on a per-user table whose strict
-- `user_isolation` policy (0105) already covers every row. No new table, so
-- `bms-owner-rls.integration.spec.ts`'s FORCED_TABLES is unchanged.
--
-- ROLE AND GRANTS. Run as bms_owner inside SET ROLE / RESET ROLE: it owns both
-- tables (0041), so it may add the column and the foreign key. No GRANT — a
-- new column inherits the table's privileges.
--
-- Forward-only. No seed rows.

SET ROLE bms_owner;

ALTER TABLE bms.copilot_conversations
  ADD COLUMN IF NOT EXISTS onboarding_session_id uuid
  REFERENCES bms.onboarding_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS copilot_conversations_onboarding_session_idx
  ON bms.copilot_conversations (onboarding_session_id)
  WHERE onboarding_session_id IS NOT NULL;

COMMENT ON COLUMN bms.copilot_conversations.onboarding_session_id IS
  'The onboarding session this conversation''s turns run (ADR 0099 decision 7, the onboarding skill); null for a plain conversation';

RESET ROLE;
