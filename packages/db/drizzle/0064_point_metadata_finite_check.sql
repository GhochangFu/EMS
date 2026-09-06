-- F2.7 / ADR 0056 decision 2, fourth within-row rule — the four numeric
-- point-metadata columns on bms.template_points and bms.asset_points must be
-- FINITE. Found by the PR 1 migration and security reviews on 2026-09-06, the
-- day 0063 landed; a new file because 0063 is committed and therefore frozen.
--
-- WHY 0063'S CHECKS DO NOT ALREADY DO THIS. PostgreSQL defines NaN as equal to
-- itself and greater than every non-NaN float8, so that float8 columns can be
-- sorted and indexed. Measured on this database before writing, not reasoned
-- about:
--
--   SELECT 'NaN'::float8 <> 0;          -- t   (0063's scale_multiplier check passes NaN)
--   SELECT 100::float8 < 'NaN'::float8; -- t   (0063's eng_min < eng_max passes eng_max = NaN)
--   SELECT 'Infinity'::float8 <> 0;     -- t
--
-- So `scale_multiplier = 'NaN'` and `eng_min = 100, eng_max = 'NaN'` are both
-- admitted by 0063. The ingest host computes `raw * multiplier + offset` and
-- then tests the result with Number.isFinite, so a NaN multiplier does not
-- corrupt telemetry — it silently drops every reading of that point as
-- `nonFinite` instead, which is a different way of losing the data. The API's
-- Zod layer refuses non-finite input (`point-metadata.schema.ts`, `.finite()`),
-- so today the exposure is direct writers only: psql, a future migration, and
-- the mapping-sheet importer PR 2 ships, which reads every cell as text and
-- then parses a number.
--
-- THE RANGE FORM, NOT `col = col`. Migration 0031 moved exactly this guarantee
-- into the database for telemetry.point_values.value and recorded why the
-- classic NaN guard is a no-op here: Postgres makes NaN = NaN TRUE. The range
-- form rejects NaN *because* NaN sorts above 'Infinity' (so `col < 'Infinity'`
-- is false for it) and rejects both infinities as well — which is the
-- guarantee the host actually relies on: finite, not merely not-NaN.
--
-- ONE CONSTRAINT PER TABLE covering all four columns, NULL-permissive per
-- column: NULL still means "inherit" / "no rule" (ADR 0056 decision 1), and a
-- row that sets only eng_max must not be refused for the three it leaves NULL.
-- quality_policy is a varchar and has no finite question.
--
-- SAFE TO VALIDATE ON EXISTING ROWS: every row of both tables reads NULL across
-- the four today (the columns arrived in 0063 hours ago and the only writer is
-- the .finite()-guarded API), so the constraint validates against a table with
-- no violating row. If a later install ever holds a non-finite value here, this
-- migration fails loudly on that row rather than skipping it — the right
-- outcome, since the row is already breaking the host's arithmetic.
--
-- ADR 0045 / AGENTS.md §4.4 — THIS FILE TAKES THE `SET ROLE bms_owner` /
-- `RESET ROLE` BRACKET, and says so because nothing machine-checks which branch
-- a migration picked. The default branch applies, per 0060's header and 0063's:
-- `bms_owner` owns both tables, and `ADD CONSTRAINT` is an ordinary write the
-- owner may make — no cross-role `ALTER ... OWNER TO`, no `GRANT`, no policy
-- change, so the connecting superuser is not needed.
--
-- Forward-only and idempotent: each constraint is added only when absent, the
-- guard qualified on conname AND conrelid (the 0023 shape).

SET ROLE bms_owner;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'template_points_point_metadata_finite_check'
      AND conrelid = 'bms.template_points'::regclass
  ) THEN
    ALTER TABLE bms.template_points
      ADD CONSTRAINT template_points_point_metadata_finite_check
      CHECK (
        (scale_multiplier IS NULL OR (scale_multiplier > '-Infinity'::float8 AND scale_multiplier < 'Infinity'::float8))
        AND (scale_offset IS NULL OR (scale_offset > '-Infinity'::float8 AND scale_offset < 'Infinity'::float8))
        AND (eng_min IS NULL OR (eng_min > '-Infinity'::float8 AND eng_min < 'Infinity'::float8))
        AND (eng_max IS NULL OR (eng_max > '-Infinity'::float8 AND eng_max < 'Infinity'::float8))
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'asset_points_point_metadata_finite_check'
      AND conrelid = 'bms.asset_points'::regclass
  ) THEN
    ALTER TABLE bms.asset_points
      ADD CONSTRAINT asset_points_point_metadata_finite_check
      CHECK (
        (scale_multiplier IS NULL OR (scale_multiplier > '-Infinity'::float8 AND scale_multiplier < 'Infinity'::float8))
        AND (scale_offset IS NULL OR (scale_offset > '-Infinity'::float8 AND scale_offset < 'Infinity'::float8))
        AND (eng_min IS NULL OR (eng_min > '-Infinity'::float8 AND eng_min < 'Infinity'::float8))
        AND (eng_max IS NULL OR (eng_max > '-Infinity'::float8 AND eng_max < 'Infinity'::float8))
      );
  END IF;
END $$;

RESET ROLE;
