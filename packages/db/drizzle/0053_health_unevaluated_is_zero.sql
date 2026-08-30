-- ADR 0050 + Amendment 1 decision 7 (E1.3) — enforce what 0052's header only claimed.
--
-- `0052_health_in_range_counters.sql` lines 134-136 state:
--
--   SO `rule_count = 0` WITH `skipped_rule_count > 0` IS A REAL STATE, and in it
--   `in_range_count` IS MEANINGLESS AND IS WRITTEN AS 0.
--
-- THAT WAS FALSE WHEN IT WAS WRITTEN. This migration makes it true, and does so
-- as a constraint rather than as a second sentence.
--
-- ============================================================================
-- WHAT WENT WRONG, BECAUSE IT LOOKED LIKE CORRECT CODE.
-- ============================================================================
--
-- `in-range-sql.ts` builds an ELSE-less `CASE r.operator`, which is SQL NULL for
-- a rule carrying a NULL `operator` or `threshold_value`. That NULL sits inside
-- `WHERE ... AND <CASE>` of a `NOT EXISTS` subquery. `WHERE NULL` matches no
-- row, so `NOT EXISTS` is TRUE — for every sample. The `count(*) FILTER (...)`
-- therefore counted them all, and a tag whose only matching rules were
-- unevaluatable stored `in_range_count = sample_count`: a perfect 1.0 ratio
-- manufactured by rules that do nothing.
--
-- The missing ELSE is correct and stays. It is what stops a skipped rule being
-- read as "did not fire". What was missing is the outer guard on the count.
--
-- `0052`'s other two CHECK constraints both accept the bad row:
-- `in_range_count BETWEEN 0 AND sample_count` is satisfied by equality, and
-- `rule_count + skipped_rule_count > 0` is satisfied by the skipped rule.
--
-- Found by the `E1.3` security review and independently by the migration
-- review, and reproduced against a live database before either fix was written.
--
-- ============================================================================
-- WHY A CONSTRAINT AND NOT ONLY THE APPLICATION FIX.
-- ============================================================================
--
-- `health-rollup-sql.ts` now wraps the count in
-- `CASE WHEN m.rule_count = 0 THEN 0 ELSE ... END`, which is the actual repair.
-- This constraint exists because that repair lives in one writer and the table
-- outlives it.
--
-- The reader's guard is NOT a substitute, and this is the part worth reading:
-- `asset-health.service.ts` excludes a tag on `max(rule_count) = 0` across the
-- whole read window. A window mixing ONE all-skipped bucket with ONE evaluated
-- bucket yields `max(rule_count) = 1`, so the guard passes and the fabricated
-- samples are summed straight into the ratio. That is reachable in normal
-- operation: the `1m` roll-up only rewrites a 24-hour trailing window, while a
-- `1h`/`1d` read reaches much further back over buckets no later tick corrects.
--
-- And any second consumer — a report, a dashboard widget, an ad-hoc
-- `sum(in_range_count) / sum(sample_count)` — reproduces the inflation without
-- ever seeing the guard. ADR 0050 decision 3 and Amendment 1 decision 7 exist to
-- prevent exactly that, so the invariant belongs where every reader meets it.
--
-- ============================================================================
-- WHY THIS IS A NEW FILE AND NOT AN EDIT TO 0052.
-- ============================================================================
--
-- AGENTS.md §4.4, forward-only. Drizzle tracks applied migrations by content
-- hash and never re-runs one, so editing `0052` would silently not reach any
-- database that has already run it — including the local dev database this was
-- reproduced on. The pre-commit hook refused the edit and was right to.
--
-- ============================================================================
-- IDEMPOTENT, AND WHY IT NEEDS A DO BLOCK TO BE.
-- ============================================================================
--
-- PostgreSQL has no `ADD CONSTRAINT IF NOT EXISTS`. A bare `ALTER TABLE ... ADD
-- CONSTRAINT` therefore fails on a second run, which §4.4 forbids. The `DO`
-- block checks `pg_constraint` first.
--
-- NO `SET ROLE bms_owner` BRACKET HERE, and that is deliberate rather than an
-- omission. `0051`'s header records the rule: ownership does not change on
-- `ALTER TABLE`, and these four tables are already owned by `bms_owner` from
-- `0052`'s own bracket. Adding one by symmetry would suggest the bracket matters
-- for ALTER, which is exactly the misreading `0051` warns against.

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['1m', '5m', '1h', '1d'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = format('point_in_range_%s_unevaluated_is_zero_check', target)
         AND conrelid = format('telemetry.point_in_range_%s', target)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE telemetry.point_in_range_%s ADD CONSTRAINT '
        'point_in_range_%s_unevaluated_is_zero_check '
        'CHECK (rule_count > 0 OR in_range_count = 0)',
        target, target
      );
    END IF;
  END LOOP;
END
$$;
