-- E1.9f / ADR 0135 Amendment 8 decision 13 — the sixteenth dashboard widget type, `ml_findings`.
--
-- The 0161 shape: `dashboard_widgets_widget_type_check` gains `ml_findings` (sixteen values; the
-- fifteen are 0161's). DROP + ADD, not `IF NOT EXISTS`, because the constraint already exists.
-- No `SET ROLE` bracket (no object is created and ownership does not change on `ALTER TABLE`)
-- and no down migration (AGENTS.md §4.4, forward-only). `bms.dashboard_widgets` is bounded per
-- dashboard, so the validation scan under the ACCESS EXCLUSIVE lock is trivial, and the lock wait
-- is bounded so a busy table fails the deploy rather than queueing every read behind it.
-- Widening is safe in both directions: no stored row can fail the wider CHECK, and an older
-- `apps/api` never writes the new value.
--
-- An ml_findings widget binds no point and no source; its scope is its dashboard's own, and its
-- `config` holds only renderer options (`show`, `paragraph`), so nothing else changes. It touches
-- no object in the ML schema. No statement-breakpoint markers (the 0038 reason).
--
-- THE CHECK AND ITS ENUM ARE TWO DECLARATIONS OF ONE VOCABULARY (ADR 0047 decision 2). The IN list
-- below must equal `widgetTypeSchema` in `packages/shared/src/contracts/dashboard-builder.ts`;
-- `tests/e1.9f-ml-findings-widget-type.test.ts`, `tests/f3.32-mimic-widget.test.ts` and
-- `tests/f3.73-site-widget-types.test.ts` compare them.

SET LOCAL lock_timeout = '5s';

ALTER TABLE bms.dashboard_widgets
  DROP CONSTRAINT IF EXISTS dashboard_widgets_widget_type_check;

ALTER TABLE bms.dashboard_widgets
  ADD CONSTRAINT dashboard_widgets_widget_type_check
  CHECK (widget_type IN ('radial_gauge', 'tank_level', 'value_tile', 'chart', 'table', 'mimic', 'active_alarms_rail', 'state_legend', 'asset_class_strip', 'module_summary_card', 'critical_systems_list', 'breaker_table', 'trend_strip', 'forecast', 'anomaly', 'ml_findings'));

RESET lock_timeout;

-- The proof: the constraint exists on the table and its definition names the new value and the
-- one before it, so a dropped-but-not-re-added constraint or a truncated list fails the deploy.
DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO definition
    FROM pg_constraint c
   WHERE c.conrelid = 'bms.dashboard_widgets'::regclass
     AND c.conname = 'dashboard_widgets_widget_type_check';
  IF definition IS NULL THEN
    RAISE EXCEPTION 'migration 0163: dashboard_widgets_widget_type_check is missing';
  END IF;
  IF position('''ml_findings''' IN definition) = 0 THEN
    RAISE EXCEPTION 'migration 0163: dashboard_widgets_widget_type_check does not admit ml_findings';
  END IF;
  IF position('''anomaly''' IN definition) = 0 THEN
    RAISE EXCEPTION 'migration 0163: dashboard_widgets_widget_type_check no longer admits anomaly';
  END IF;
END
$$;
