-- F4.247 / ADR 0099 Amendment 5 C1 — the precondition a copilot change was
-- proposed under.
--
--   - `bms.copilot_pending_changes.precondition`: nullable varchar(40). For a
--     catalog entry flagged `precondition: "updatedAt"` (the two list writes,
--     `dashboard.widgets.replace` and `assetTemplate.update`) it holds the
--     target row's updated_at as a millisecond ISO instant (24 characters),
--     read at propose time. The Confirm's If-Match must name it. It is stored
--     and compared as the exact string the DTO carries, never cast back to a
--     timestamp. NULL for every other entry, and for a change proposed before
--     this migration (Amendment 5 C5 c). No DEFAULT.
--
-- POLICY. Unchanged: the column is on a table whose user_isolation policy
-- (0105) already covers every row. No new table, so FORCED_TABLES is unchanged.
--
-- ROLE AND GRANTS. Run as bms_owner inside SET ROLE / RESET ROLE: it owns the
-- table. No GRANT — a new column inherits the table's privileges.
--
-- Forward-only. No seed rows, no backfill.

SET ROLE bms_owner;

ALTER TABLE bms.copilot_pending_changes ADD COLUMN IF NOT EXISTS precondition varchar(40);

COMMENT ON COLUMN bms.copilot_pending_changes.precondition IS
  'ADR 0099 Amendment 5 C1: the target row''s updated_at (ms ISO) read at propose time; the Confirm''s If-Match must equal it; NULL for an entry with no precondition';

RESET ROLE;
