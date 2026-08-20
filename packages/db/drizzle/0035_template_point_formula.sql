-- ADR 0036 decision 5 — a derived template_points row records how it is
-- computed. `template_points.kind` (measured | derived, migration 0015) has
-- carried no formula column since it was added: F2.2 already refuses to
-- instantiate a derived point into asset_points, and nothing before F2.3
-- recorded what a derived point's value comes from.
--
-- Additive and nullable, no backfill: `SELECT count(*) FROM
-- bms.template_points WHERE kind = 'derived'` is 0 in every environment this
-- was checked against (no seed creates one), so there is nothing to fill in.
-- If a derived row exists in some other database, it becomes invalid on its
-- next write rather than silently accepted — see decision 5's enforcement
-- note below.
--
-- No CHECK constraint, on purpose. The kind/formula exclusivity
-- (kind = 'derived' requires both columns set to a non-empty formula and
-- 'bms-calc-v1'; kind = 'measured' requires both absent) is enforced at the
-- Zod layer in apps/api's templatePointBodySchema, mirroring the existing
-- precedent for a two-column exclusivity invariant in that same module —
-- instantiateAssetsBodySchema's rtuId/locationId pair — because both write
-- paths (create, update) already funnel through one validator. A DB CHECK
-- here would duplicate that decision in a place migrations, not application
-- code, would have to keep in sync with the dialect vocabulary as it grows.
--
-- Forward-only and idempotent: IF NOT EXISTS matches migration 0032's
-- discipline, so a partially-applied re-run does not fail on the second
-- column if the first already landed.
ALTER TABLE bms.template_points
  ADD COLUMN IF NOT EXISTS formula text;
--> statement-breakpoint
ALTER TABLE bms.template_points
  ADD COLUMN IF NOT EXISTS formula_dialect varchar(32);
