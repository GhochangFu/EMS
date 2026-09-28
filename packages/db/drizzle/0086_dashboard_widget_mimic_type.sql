-- F3.32 v1 / ADR 0079 decision 1 — the sixth widget type, `mimic`.
--
-- This migration widens `dashboard_widgets_widget_type_check` to accept
-- `'mimic'`, and does nothing else — the `0055` precedent
-- (`packages/db/drizzle/0055_dashboard_widget_table_type.sql`), which widened
-- the same CHECK for `'table'`. Read that file's header for the reasoning this
-- one repeats rather than restates: DROP + ADD (not `IF NOT EXISTS`, because
-- the constraint already exists), no `SET ROLE` bracket (ownership does not
-- change on `ALTER TABLE`; `bms_owner` already owns the table from `0050`),
-- and no down migration (AGENTS.md §4.4, forward-only).
--
-- THE LOCK. Same as `0055`: `bms.dashboard_widgets` holds at most
-- `MAX_DASHBOARD_WIDGETS` rows per dashboard, so the CHECK's validation scan
-- under the ACCESS EXCLUSIVE lock `ADD CONSTRAINT` takes is trivial.
--
-- WIDENING IS SAFE IN BOTH DIRECTIONS. A widened CHECK accepts every value the
-- narrow one did, so no stored row can fail it, and an older `apps/api` simply
-- never writes `'mimic'`.
--
-- THE CHECK AND `widgetTypeSchema` ARE TWO DECLARATIONS OF ONE VOCABULARY
-- (ADR 0047 decision 2; the `F4.43` failure this guards against). The IN list
-- below must equal `widgetTypeSchema`'s enum, and `tests/f3.32-mimic-widget.test.ts`
-- parses both and compares them the way `tests/f3.35-table-widget-schema.test.ts`
-- does for `0055`. It is expected to read red until `packages/shared/src/contracts/
-- dashboard-builder.ts`'s `widgetTypeSchema` gains `"mimic"` (U0 of this plan) —
-- that is a cross-unit drift gate doing its job, not a defect in this file.

ALTER TABLE bms.dashboard_widgets
  DROP CONSTRAINT IF EXISTS dashboard_widgets_widget_type_check;

ALTER TABLE bms.dashboard_widgets
  ADD CONSTRAINT dashboard_widgets_widget_type_check
  CHECK (widget_type IN ('radial_gauge', 'tank_level', 'value_tile', 'chart', 'table', 'mimic'));
