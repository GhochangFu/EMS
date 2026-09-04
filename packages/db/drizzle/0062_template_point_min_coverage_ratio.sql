-- F2.9 / ADR 0055 decision 11 — the minimum coverage ratio a `bms-calc-v2`
-- aggregate needs before it will compute a value at all.
--
-- WHY ONE COLUMN. Decision 11 names a single per-point knob, and it lives on
-- `bms.template_points` only — the ADR and this row's plan (`docs/plans/
-- f2.9-cross-asset-calc-v2.md`, Task 4) both refuse a per-asset override:
-- `min_coverage_ratio` describes the *formula*, which is authored once on the
-- template, not the asset instance. Nothing else on this row needs a second
-- column: unlike `0061`'s stock stamp, this value has no paired field whose
-- presence or absence must agree, so there is no companion `CHECK` to close.
--
-- WHY NULLABLE, AND WHY NULL DOES NOT MEAN "NO LIMIT". `NULL` is the
-- **strictest** setting, not the loosest: per decision 11 it means every
-- declared member of the aggregate must be fresh, with no floor to compute a
-- partial value against. A ratio in `(0, 1]` relaxes that requirement to
-- "at least this fraction of declared members must be fresh". The column
-- must be nullable because that fail-closed default is the correct behaviour
-- for every `v2` aggregate that never sets it explicitly, and because every
-- existing row (every `v1` template point, and any `v2` point authored before
-- this column had a value) must read as fail-closed rather than as
-- unbounded — a default of `1` would silently mean the same thing here, but
-- `NULL` is what `packages/api`'s coverage evaluator (`calc-aggregate.ts`,
-- Task 13) is specified to test for, so the column matches the code that
-- reads it.
--
-- WHY NO CHECK. The bound `(0, 1]` is enforced in `apps/api`'s Zod layer
-- (`asset-templates.schema.ts`, Task 6:
-- `minCoverageRatio: z.number().gt(0).max(1).nullish()`), the same split ADR
-- 0055 names and the same precedent migrations `0035` and `0036` set for
-- `formula`/`calcTrigger` on this very table: a nullable column with no `CHECK`,
-- because the kind/formula and trigger/interval exclusivity rules those files
-- describe are enforced in the API layer, not the database. A `CHECK` here
-- would duplicate a bound the Zod schema already owns and could drift from it.
--
-- ADR 0045 / AGENTS.md §4.4 — THIS FILE TAKES THE `SET ROLE bms_owner` /
-- `RESET ROLE` BRACKET, and says so because nothing machine-checks which
-- branch a migration picked. The default branch applies, per `0060`'s header:
-- `bms_owner` owns `bms.template_points`, and `ADD COLUMN` is an ordinary
-- write the owner may make — no cross-role `ALTER ... OWNER TO` and no
-- role-membership `GRANT`, so the connecting superuser is not needed. `RESET
-- ROLE` is the half that bites: a forgotten one leaks past `COMMIT` into the
-- session, so drizzle's own journal `INSERT` and every later file in the same
-- run would execute as `bms_owner`, which holds no grant on the `drizzle`
-- schema.
--
-- Forward-only and idempotent. Indexed 0062: 0056-0061 are committed and
-- frozen, and the journal `when` is strictly greater than 0061's
-- 1788957183386, or drizzle applies nothing and every check downstream passes
-- against a schema short one column (`0024`'s header records this).

SET ROLE bms_owner;

ALTER TABLE bms.template_points
  ADD COLUMN IF NOT EXISTS min_coverage_ratio double precision;

RESET ROLE;
