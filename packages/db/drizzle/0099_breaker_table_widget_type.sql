-- F3.74 / ADR 0088 decision 10 — the twelfth dashboard widget type, `breaker_table`.
--
-- One CHECK widening, nothing else, in the `0096` / `0086` shape:
--
-- `dashboard_widgets_widget_type_check` gains `breaker_table` (twelve values in all; the eleven
-- are `0096`'s).
--
-- Read `0096`'s and `0086`'s headers for the reasoning this file repeats rather than restates:
-- DROP + ADD (not `IF NOT EXISTS`, because the constraint already exists), no `SET ROLE` bracket
-- (ownership does not change on `ALTER TABLE`; `bms_owner` already owns the table), and no down
-- migration (AGENTS.md §4.4, forward-only).
--
-- THE LOCK. `bms.dashboard_widgets` is bounded per dashboard (`MAX_DASHBOARD_WIDGETS`), so the
-- validation scan under the ACCESS EXCLUSIVE lock `ADD CONSTRAINT` takes is trivial.
--
-- WIDENING IS SAFE IN BOTH DIRECTIONS. A widened CHECK accepts every value the narrow one did, so
-- no stored row can fail it, and an older `apps/api` simply never writes the new value.
--
-- THE CHECK AND ITS ENUM ARE TWO DECLARATIONS OF ONE VOCABULARY (ADR 0047 decision 2; the `F4.43`
-- failure this guards against). The IN list below must equal `widgetTypeSchema` in
-- `packages/shared/src/contracts/dashboard-builder.ts`; `tests/f3.32-mimic-widget.test.ts`,
-- `tests/f3.73-site-widget-types.test.ts` and `tests/f3.74-breaker-table-widget-type.test.ts`
-- compare them.

ALTER TABLE bms.dashboard_widgets
  DROP CONSTRAINT IF EXISTS dashboard_widgets_widget_type_check;

ALTER TABLE bms.dashboard_widgets
  ADD CONSTRAINT dashboard_widgets_widget_type_check
  CHECK (widget_type IN ('radial_gauge', 'tank_level', 'value_tile', 'chart', 'table', 'mimic', 'active_alarms_rail', 'state_legend', 'asset_class_strip', 'module_summary_card', 'critical_systems_list', 'breaker_table'));
