-- `F2.23` / ADR 0065 decisions 2, 3 and 5 — one character class,
-- `^[A-Za-z0-9_-]+$`, enforced as a plain `CHECK` on both catalog code
-- columns: `bms.assets.code` and `bms.point_keys.code`. Letters of either
-- case, digits, `_` and `-`; nothing else — no `.`, no whitespace, no
-- `{ } ( ) @ '`, no non-ASCII character. `CATALOG_CODE_PATTERN` in
-- `packages/shared/src/constants.ts` is the one other place this class is
-- written down; `tests/f2.23-catalog-code-charset.test.ts` asserts the two
-- strings are byte-identical so they cannot drift apart silently.
--
-- DECISION 3 — A PLAIN `ADD CONSTRAINT`, NO `NOT VALID`. The statement scans
-- the whole table when it runs. A row outside the class stops the migration
-- with Postgres's own message:
--
--   ERROR:  check constraint "assets_code_charset_check" of relation
--   "assets" is violated by some row
--
-- (and the equivalent naming `point_keys_code_charset_check` and
-- "point_keys"). That is the safe failure direction for a deploy: ADR 0065
-- §2 measured every row in the live database and every seed/fixture source
-- against this class before this file was written, and none violates it, so
-- the scan is expected to pass. If it does not, THE OPERATOR REPAIRS THE
-- OFFENDING ROW BY HAND AND RE-RUNS THIS MIGRATION — there is no automatic
-- repair (decision 5, ADR 0065 §4): a code rename is not one statement
-- (`asset_points.point_key` / `template_points.point_key` reference it with
-- `NO ACTION`, and stored formulas and `asset_templates.content` name it as
-- text), and an identifier an operator knows by name is theirs to change.
-- This file therefore contains no `UPDATE` and no `DELETE`.
--
-- ADR 0045 / AGENTS.md §4.4 — THIS FILE TAKES THE `SET ROLE bms_owner` /
-- `RESET ROLE` BRACKET, in the `0061` shape: an idempotent `DO $$ … IF NOT
-- EXISTS (SELECT 1 FROM pg_constraint …)` block per constraint, so a second
-- run is a no-op rather than an error on an already-present constraint.
--
-- Lock acquisition is bounded exactly as `0069` bounds it on
-- `telemetry.point_values`: `ADD CONSTRAINT` on `bms.assets` takes ACCESS
-- EXCLUSIVE, and every ingest write FK-checks through `asset_points` against
-- that table, so an unbounded wait would stall the hot telemetry path behind
-- any in-flight reader. Five seconds, then fail and be re-run, rather than
-- hold the table.

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint

SET ROLE bms_owner;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'assets_code_charset_check'
       AND conrelid = 'bms.assets'::regclass
  ) THEN
    ALTER TABLE bms.assets
      ADD CONSTRAINT assets_code_charset_check
      CHECK (code ~ '^[A-Za-z0-9_-]+$');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'point_keys_code_charset_check'
       AND conrelid = 'bms.point_keys'::regclass
  ) THEN
    ALTER TABLE bms.point_keys
      ADD CONSTRAINT point_keys_code_charset_check
      CHECK (code ~ '^[A-Za-z0-9_-]+$');
  END IF;
END $$;

RESET ROLE;
--> statement-breakpoint

RESET lock_timeout;
