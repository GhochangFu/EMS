-- ADR 0056 decisions 1 and 2 — five point-metadata columns on both
-- `bms.template_points` (the class default) and `bms.asset_points` (the
-- per-asset override), and three within-row CHECKs on each.
--
-- WHY FIVE COLUMNS ON TWO TABLES. Decision 1's table:
--   scale_multiplier double precision — engineering value = raw * multiplier + offset
--   scale_offset     double precision — as above
--   eng_min          double precision — lower plausibility bound, inclusive
--   eng_max          double precision — upper plausibility bound, inclusive
--   quality_policy   varchar(16)      — discard_bad | accept_bad
-- This is ADR 0039 decisions 6/7's pattern for the calc-config columns on
-- these same two tables (migrations 0035-0037), reused rather than
-- reinvented: five nullable columns, not one jsonb blob, so a partial
-- override restates one field, not a point. The resolved value is
-- `coalesce(asset_points.col, template_points.col)` per column, joined
-- through `assets.template_id` and `point_key` — apps/ingest's BINDING_QUERY
-- (Unit D of this plan) is the reader.
--
-- WHY NULLABLE, AND WHAT NULL MEANS. A resolved NULL across all five is
-- today's behaviour, spelled out: multiplier 1, offset 0, no range test,
-- discard_bad. Every existing row and every blank sheet/form cell must keep
-- reading that way, so no column may default to anything else and none may
-- be NOT NULL. An asset with no template has no default to inherit and its
-- own columns are the whole value.
--
-- WHY CHECKS HERE, AND NOT IN 0035/0036'S WAY. Migrations 0035-0037 left
-- their invariants to apps/api's Zod layer alone, because those rules are
-- cross-column exclusivity (kind/formula) or depend on a *resolved* value the
-- row cannot see on its own (trigger/interval). The three rules this file
-- adds are different: `eng_min < eng_max`, `scale_multiplier <> 0` and
-- `quality_policy IN (...)` are each true or false looking at one row alone,
-- with no other table involved — a within-row invariant, exactly the shape
-- `asset_points_source_ref_check` (migration 0023) already enforces on
-- `asset_points`. What a row CHECK cannot see is the *resolved* pair — an
-- asset override of `eng_min` beside an inherited `eng_max` can invert the
-- band while each row is valid alone — so that merged-pair check stays in
-- apps/api's Zod layer (`validateMergedPointMetadata`, Unit C), exactly where
-- ADR 0039 put the resolved trigger/interval check for the same reason.
--
-- ADR 0045 / AGENTS.md SS4.4 — THIS FILE TAKES THE `SET ROLE bms_owner` /
-- `RESET ROLE` BRACKET, and says so because nothing machine-checks which
-- branch a migration picked. The default branch applies, per 0060's header:
-- `bms_owner` owns both `bms.template_points` and `bms.asset_points`, and
-- `ADD COLUMN` / `ADD CONSTRAINT` are ordinary owner writes — no cross-role
-- `ALTER ... OWNER TO`, no role-membership `GRANT`, no policied read. `RESET
-- ROLE` is the half that bites: a forgotten one leaks past `COMMIT` into the
-- session, so drizzle's own journal `INSERT` and every later file in the
-- same run would execute as `bms_owner`, which holds no grant on the
-- `drizzle` schema.
--
-- Forward-only and idempotent: every `ADD COLUMN` is `IF NOT EXISTS` and
-- every `ADD CONSTRAINT` is guarded by a `pg_constraint` existence check
-- qualified on both `conname` and `conrelid` (0023's shape — `conname` alone
-- is only unique per relation, not globally, so an unqualified lookup would
-- skip the `ADD CONSTRAINT` if any other table anywhere carried the same
-- name, leaving the table unconstrained while the migration reported
-- success). No `DEFAULT` anywhere.

SET ROLE bms_owner;

ALTER TABLE bms.template_points
  ADD COLUMN IF NOT EXISTS scale_multiplier double precision;
ALTER TABLE bms.template_points
  ADD COLUMN IF NOT EXISTS scale_offset double precision;
ALTER TABLE bms.template_points
  ADD COLUMN IF NOT EXISTS eng_min double precision;
ALTER TABLE bms.template_points
  ADD COLUMN IF NOT EXISTS eng_max double precision;
ALTER TABLE bms.template_points
  ADD COLUMN IF NOT EXISTS quality_policy varchar(16);

ALTER TABLE bms.asset_points
  ADD COLUMN IF NOT EXISTS scale_multiplier double precision;
ALTER TABLE bms.asset_points
  ADD COLUMN IF NOT EXISTS scale_offset double precision;
ALTER TABLE bms.asset_points
  ADD COLUMN IF NOT EXISTS eng_min double precision;
ALTER TABLE bms.asset_points
  ADD COLUMN IF NOT EXISTS eng_max double precision;
ALTER TABLE bms.asset_points
  ADD COLUMN IF NOT EXISTS quality_policy varchar(16);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'template_points_eng_range_check'
      AND conrelid = 'bms.template_points'::regclass
  ) THEN
    ALTER TABLE bms.template_points
      ADD CONSTRAINT template_points_eng_range_check
      CHECK (eng_min IS NULL OR eng_max IS NULL OR eng_min < eng_max);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'template_points_scale_multiplier_check'
      AND conrelid = 'bms.template_points'::regclass
  ) THEN
    ALTER TABLE bms.template_points
      ADD CONSTRAINT template_points_scale_multiplier_check
      CHECK (scale_multiplier IS NULL OR scale_multiplier <> 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'template_points_quality_policy_check'
      AND conrelid = 'bms.template_points'::regclass
  ) THEN
    ALTER TABLE bms.template_points
      ADD CONSTRAINT template_points_quality_policy_check
      CHECK (quality_policy IS NULL OR quality_policy IN ('discard_bad', 'accept_bad'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_points_eng_range_check'
      AND conrelid = 'bms.asset_points'::regclass
  ) THEN
    ALTER TABLE bms.asset_points
      ADD CONSTRAINT asset_points_eng_range_check
      CHECK (eng_min IS NULL OR eng_max IS NULL OR eng_min < eng_max);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_points_scale_multiplier_check'
      AND conrelid = 'bms.asset_points'::regclass
  ) THEN
    ALTER TABLE bms.asset_points
      ADD CONSTRAINT asset_points_scale_multiplier_check
      CHECK (scale_multiplier IS NULL OR scale_multiplier <> 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_points_quality_policy_check'
      AND conrelid = 'bms.asset_points'::regclass
  ) THEN
    ALTER TABLE bms.asset_points
      ADD CONSTRAINT asset_points_quality_policy_check
      CHECK (quality_policy IS NULL OR quality_policy IN ('discard_bad', 'accept_bad'));
  END IF;
END $$;

RESET ROLE;
