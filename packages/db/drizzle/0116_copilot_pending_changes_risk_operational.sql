-- F4.284 / ADR 0106 — the fifth risk class a copilot change can carry.
--
--   - `bms.copilot_pending_changes_risk_check` gains `operational`: an alarm
--     acknowledge or a work-order close proposed by the copilot. The Confirm
--     card shows it red with "This cannot be undone." The four earlier values
--     (0105) are unchanged, so every stored row still satisfies the CHECK.
--
-- POLICY. Unchanged: the table's user_isolation policy (0105) covers every
-- row. No new table, so FORCED_TABLES is unchanged.
--
-- ROLE AND GRANTS. Run as bms_owner inside SET ROLE / RESET ROLE: it owns the
-- table. No GRANT — a constraint changes no privilege.
--
-- Forward-only. No seed rows, no backfill.

SET ROLE bms_owner;

ALTER TABLE bms.copilot_pending_changes DROP CONSTRAINT IF EXISTS copilot_pending_changes_risk_check;

ALTER TABLE bms.copilot_pending_changes ADD CONSTRAINT copilot_pending_changes_risk_check CHECK (risk IN ('create','edit','deactivate','access','operational'));

RESET ROLE;
