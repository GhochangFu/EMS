-- F4.305 / ADR 0108 Amendment 3 — the thirteenth dashboard widget type, `trend_strip`, and the
-- once-per-copy stamp of the stock v5 upgrade.
--
-- Two changes, in the `0099` shape for the first:
--
-- 1. `dashboard_widgets_widget_type_check` gains `trend_strip` (thirteen values; the twelve are
--    `0099`'s). DROP + ADD, not `IF NOT EXISTS`, because the constraint already exists. No
--    `SET ROLE` bracket (ownership does not change on `ALTER TABLE`) and no down migration
--    (AGENTS.md §4.4, forward-only). `bms.dashboard_widgets` is bounded per dashboard, so the
--    validation scan under the ACCESS EXCLUSIVE lock is trivial. Widening is safe in both
--    directions: no stored row can fail the wider CHECK, and an older `apps/api` never writes
--    the new value.
--
-- 2. `bms.dashboards.stock_version integer`, nullable, no default. It records the stock layout
--    version a seed-owned copy was last upgraded to, so the v5 step runs once per copy and a
--    strip an administrator deletes stays deleted. NULL means "never stamped". A nullable column
--    without a default is a catalog-only change; no row is rewritten and RLS is unchanged.
--
-- THE CHECK AND ITS ENUM ARE TWO DECLARATIONS OF ONE VOCABULARY (ADR 0047 decision 2). The IN list
-- below must equal `widgetTypeSchema` in `packages/shared/src/contracts/dashboard-builder.ts`;
-- `tests/f3.32-mimic-widget.test.ts`, `tests/f3.73-site-widget-types.test.ts` and
-- `tests/f4.305-trend-strip-widget-type.test.ts` compare them.

ALTER TABLE bms.dashboard_widgets
  DROP CONSTRAINT IF EXISTS dashboard_widgets_widget_type_check;

ALTER TABLE bms.dashboard_widgets
  ADD CONSTRAINT dashboard_widgets_widget_type_check
  CHECK (widget_type IN ('radial_gauge', 'tank_level', 'value_tile', 'chart', 'table', 'mimic', 'active_alarms_rail', 'state_legend', 'asset_class_strip', 'module_summary_card', 'critical_systems_list', 'breaker_table', 'trend_strip'));

ALTER TABLE bms.dashboards
  ADD COLUMN stock_version integer;
