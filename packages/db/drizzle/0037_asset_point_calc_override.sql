-- ADR 0039 decisions 6 and 7 — per-asset calc overrides. Migration 0035 gave
-- template_points the formula/formula_dialect pair and 0036 gave it the
-- trigger/staleness trio; this migration mirrors all five onto asset_points so
-- one asset can depart from the template it is pinned to. ADR 0037 decision 4
-- is amended by that: the template is no longer the only unit of calc
-- configuration, it is the *default* one.
--
-- NULL means "inherit from the pinned template version". That is precisely what
-- every existing asset_points row already does implicitly today, so this
-- migration is additive with no backfill and **no existing row changes
-- meaning**. Resolution becomes coalesce(asset_points.<col>,
-- template_points.<col>) per column, which is why the override is five
-- independent nullable columns rather than one jsonb blob: a partial override
-- must be able to restate one field without restating the point.
--
-- Who ever carries a non-NULL value here: only rows with source_kind =
-- 'computed'. F2.2's instantiation still emits no asset_points row for a
-- derived template point (ADR 0039 leaves it untouched), so such a row has
-- exactly two creators — CalcWriteService on first computed value (ADR 0037),
-- and, new in ADR 0039 decision 7, the override endpoint, which creates it
-- eagerly rather than waiting for a value that an override may be the very
-- thing enabling.
--
-- No CHECK constraint. Not for 0035/0036's reason — asset_points does carry
-- CHECKs (asset_points_source_kind_check, asset_points_source_ref_check from
-- migration 0023), so "this repo keeps vocabularies in application code" would
-- be false here. The reason is that the invariants are **cross-table**:
-- "calc_interval_seconds is required when the trigger is 'scheduled' and
-- forbidden when 'streaming'" constrains the *resolved* value, and the resolved
-- value depends on the template version assets.template_id pins. A row-level
-- CHECK on asset_points cannot see that row, so it could only ever police an
-- override in isolation and would reject the legitimate case of overriding
-- calc_trigger alone. Enforcement stays in apps/api's Zod layer, which
-- validates the merged result and names the inherited value it conflicts with.
--
-- bms.asset_points is a plain table, not a hypertable, so each ADD COLUMN is a
-- catalog-only operation with no rewrite and no chunk fan-out.
--
-- Forward-only and idempotent: IF NOT EXISTS matches migrations 0032/0035/0036,
-- so a partially-applied re-run does not fail on a column that already landed.
ALTER TABLE bms.asset_points
  ADD COLUMN IF NOT EXISTS formula text;
--> statement-breakpoint
ALTER TABLE bms.asset_points
  ADD COLUMN IF NOT EXISTS formula_dialect varchar(32);
--> statement-breakpoint
ALTER TABLE bms.asset_points
  ADD COLUMN IF NOT EXISTS calc_trigger varchar(16);
--> statement-breakpoint
ALTER TABLE bms.asset_points
  ADD COLUMN IF NOT EXISTS calc_interval_seconds integer;
--> statement-breakpoint
ALTER TABLE bms.asset_points
  ADD COLUMN IF NOT EXISTS max_input_age_seconds integer;
