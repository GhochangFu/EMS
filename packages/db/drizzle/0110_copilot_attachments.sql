-- F3.87 PR 3 / ADR 0099 Amendment 3 A7 — the per-organization attachment
-- switch: whether an administrator may attach a file to a copilot turn.
--
--   - `bms.copilot_org_settings.attachments_enabled`: off by default. A file on
--     a turn goes to the organization's AI provider unscrubbed, so it is the
--     organization's choice. It counts only while the row's `enabled` is true
--     (`CopilotAvailabilityService.attachmentsOn`). The global admin's write
--     creates a missing row with `enabled` false (plan ruling Q3); the
--     organization admin's write needs the row (plan D3, 409 without it).
--
-- POLICY. Unchanged: the column is on a table whose tenant policy (0104)
-- already covers every row. No new table, so FORCED_TABLES is unchanged.
--
-- ROLE AND GRANTS. Run as bms_owner inside SET ROLE / RESET ROLE: it owns the
-- table (0104). No GRANT — a new column inherits the table's privileges. The
-- DEFAULT fills the existing rows with false.
--
-- Forward-only. No seed rows.

SET ROLE bms_owner;

ALTER TABLE bms.copilot_org_settings
  ADD COLUMN IF NOT EXISTS attachments_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN bms.copilot_org_settings.attachments_enabled IS
  'ADR 0099 Amendment 3 A7: files on a copilot turn go to the organization''s AI provider unscrubbed; off by default; counts only while enabled is true';

RESET ROLE;
