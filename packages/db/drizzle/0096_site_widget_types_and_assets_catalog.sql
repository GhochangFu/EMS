-- F3.73 / ADR 0087 Amendment 1 — five site-dashboard widget types and two catalog keys.
--
-- Two CHECK widenings, nothing else, in the `0086` / `0081` shape:
--
-- 1. `dashboard_widgets_widget_type_check` gains `active_alarms_rail`,
--    `state_legend`, `asset_class_strip`, `module_summary_card` and
--    `critical_systems_list` (eleven values in all).
-- 2. `dashboard_widget_sources_catalog_key_check` gains `assets.offline.count`
--    and `assets.list` (ten values in all; the eight are `0081`'s).
--
-- Read `0086`'s and `0081`'s headers for the reasoning this file repeats rather
-- than restates: DROP + ADD (not `IF NOT EXISTS`, because each constraint
-- already exists), no `SET ROLE` bracket (ownership does not change on
-- `ALTER TABLE`; `bms_owner` already owns both tables), and no down migration
-- (AGENTS.md §4.4, forward-only).
--
-- THE LOCK. Both tables are bounded per dashboard (`MAX_DASHBOARD_WIDGETS`, and
-- `WIDGET_SOURCE_CARDINALITY` rows per widget), so the validation scan under the
-- ACCESS EXCLUSIVE lock `ADD CONSTRAINT` takes is trivial.
--
-- WIDENING IS SAFE IN BOTH DIRECTIONS. A widened CHECK accepts every value the
-- narrow one did, so no stored row can fail it, and an older `apps/api` simply
-- never writes the new values.
--
-- EACH CHECK AND ITS ENUM ARE TWO DECLARATIONS OF ONE VOCABULARY (ADR 0047
-- decision 2; the `F4.43` failure this guards against). The IN lists below must
-- equal `widgetTypeSchema` and `metricCatalogKeySchema` in
-- `packages/shared/src/contracts/dashboard-builder.ts`;
-- `tests/f3.32-mimic-widget.test.ts`, `tests/f3.35-metric-catalog-schema.test.ts`
-- and `tests/f3.73-site-widget-types.test.ts` compare them. They read red until
-- that file's enums gain the new values (plan Task 3.2) — a cross-unit drift
-- gate doing its job, not a defect in this file.

ALTER TABLE bms.dashboard_widgets
  DROP CONSTRAINT IF EXISTS dashboard_widgets_widget_type_check;

ALTER TABLE bms.dashboard_widgets
  ADD CONSTRAINT dashboard_widgets_widget_type_check
  CHECK (widget_type IN ('radial_gauge', 'tank_level', 'value_tile', 'chart', 'table', 'mimic', 'active_alarms_rail', 'state_legend', 'asset_class_strip', 'module_summary_card', 'critical_systems_list'));

ALTER TABLE bms.dashboard_widget_sources
  DROP CONSTRAINT IF EXISTS dashboard_widget_sources_catalog_key_check;

ALTER TABLE bms.dashboard_widget_sources
  ADD CONSTRAINT dashboard_widget_sources_catalog_key_check
  CHECK (catalog_key IN ('alarms.active.count', 'alarms.active', 'workorders.open.count', 'workorders.open', 'assets.health.score', 'sustainability.total', 'sustainability.by_location', 'water.balance', 'assets.offline.count', 'assets.list'));
