-- ADR 0037 decision 4 — when a derived template_points row's formula runs,
-- and how stale its inputs may be. ADR 0036 (migration 0035) added the
-- formula/formula_dialect pair that says *how* a derived point is computed;
-- this migration adds the trigger/staleness pair that says *when*.
--
-- Additive and nullable, no backfill: every existing derived row (there are
-- none in seed data, same fact migration 0035 recorded) has calc_trigger
-- NULL until an author sets it. F2.4's engine treats a NULL calc_trigger as
-- a counted skip ("no_trigger"), never a default, so a pre-0036 derived row
-- is inert rather than silently active with an assumed trigger mode.
--
-- No CHECK constraint, following the same precedent migration 0035 set for
-- formula/formula_dialect: kind = 'derived' requires calc_trigger set;
-- calc_interval_seconds is required when calc_trigger = 'scheduled' and
-- forbidden when 'streaming'; both interval columns are bounded 10..86400
-- (calc_interval_seconds) and 1..86400 (max_input_age_seconds). Enforced at
-- the Zod layer in apps/api's templatePointBodySchema, not here — a DB CHECK
-- would duplicate a vocabulary this repo already keeps in application code
-- (ADR 0031's plant domains, ADR 0032's severities are the same pattern).
--
-- Forward-only and idempotent: IF NOT EXISTS matches migrations 0032/0035's
-- discipline, so a partially-applied re-run does not fail on a column that
-- already landed.
ALTER TABLE bms.template_points
  ADD COLUMN IF NOT EXISTS calc_trigger varchar(16);
--> statement-breakpoint
ALTER TABLE bms.template_points
  ADD COLUMN IF NOT EXISTS calc_interval_seconds integer;
--> statement-breakpoint
ALTER TABLE bms.template_points
  ADD COLUMN IF NOT EXISTS max_input_age_seconds integer;
