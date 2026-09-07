-- E2.4 / ADR 0058 decision 5 — provenance columns for a template-seeded rule.
--
-- Four nullable columns on `bms.automation_rules`, plus one plain index. All
-- four are `NULL` for every rule not seeded from a template — which is every
-- row on `main` today. No backfill: a seed only ever happens going forward,
-- from `instantiate()` (U4), so there is nothing to attribute retroactively.
--
-- WHY `SET ROLE bms_owner` IS LOAD-BEARING (ADR 0045 / AGENTS.md §4.4).
-- `pnpm db:migrate` connects as DATABASE_URL_SUPERUSER (`bms_app`), not as the
-- table owner. `bms.automation_rules` is owned by `bms_owner` (measured, the
-- `0066` precedent), and an `ALTER TABLE ... ADD COLUMN` from a role that does
-- not own the table still succeeds for a superuser — but the `ALTER DEFAULT
-- PRIVILEGES FOR ROLE bms_owner` grant (`0041`) only reaches columns and
-- indexes `bms_owner` itself creates. Without the bracket, the new columns and
-- the new index would carry no default grant to `bms_tenant`/`bms_fleet`, and
-- the failure would surface one endpoint at a time, the way `0039` did. `RESET
-- ROLE` at the end is the half that bites: a forgotten one leaks the session
-- role past `COMMIT` into drizzle's own journal `INSERT` and every later file
-- in the same run, and `bms_owner` holds no grant on the `drizzle` schema.
--
-- THEREFORE: NO GRANT STATEMENT IS WRITTEN, AND NONE SHOULD BE ADDED. The
-- default privileges do the work for the new column and the new index, the
-- same as `0050`, `0051`, `0056` and `0066`.
--
-- WHY THE INDEX IS PLAIN, NOT UNIQUE. An earlier draft of ADR 0058 decision 5
-- carried a partial unique index on `(source_template_id, source_alarm_code,
-- asset_id)`, and it could never fire: `instantiate()` creates *new* assets on
-- every call, so `asset_id` is always fresh and no pair of seeded rows can
-- collide on it. The guard that actually does the collision-refusing work is
-- the one migration `0048` already added — `automation_rules_org_code_idx`,
-- unique on `(organization_id, code)` — which the seed's code derivation must
-- satisfy and does not need a second index to enforce. What this migration
-- adds is a plain, non-unique index on `source_template_id`, to serve the
-- decision 8 drift-list route (`GET .../seeded-rules`) without a sequential
-- scan of the rule table. `CREATE UNIQUE INDEX` must not appear in this file.
--
-- WHY THERE IS NO BACKFILL. All four columns are nullable and mean "not
-- seeded from a template" when `NULL`. Every row that exists before this
-- migration runs was created by a route other than `instantiate()`'s alarm
-- seed (which does not exist yet — U4 lands after this migration), so leaving
-- them `NULL` is not a placeholder, it is the correct, permanent answer for
-- those rows. This file therefore writes no `UPDATE` and no `INSERT`.
--
-- Forward-only and idempotent (AGENTS.md §4.4): every `ADD COLUMN` is
-- `IF NOT EXISTS`, the index is `IF NOT EXISTS`, and the foreign key is added
-- with the column so a re-run does not error.
--
-- Indexed 0067: `0066` is committed and frozen, and the journal `when` is
-- strictly greater than `0066`'s 1788708536104, or drizzle applies nothing and
-- every check downstream passes against a schema four columns short.

SET ROLE bms_owner;

ALTER TABLE bms.automation_rules
  ADD COLUMN IF NOT EXISTS source_template_id uuid
    CONSTRAINT automation_rules_source_template_id_fk
    REFERENCES bms.asset_templates(id);

ALTER TABLE bms.automation_rules
  ADD COLUMN IF NOT EXISTS source_template_version integer;

ALTER TABLE bms.automation_rules
  ADD COLUMN IF NOT EXISTS source_alarm_code varchar(64);

ALTER TABLE bms.automation_rules
  ADD COLUMN IF NOT EXISTS seeded_baseline jsonb;

-- Plain, non-unique — decision 5 explains why no unique index is possible or
-- needed. Serves the decision 8 drift-list route.
CREATE INDEX IF NOT EXISTS automation_rules_source_template_idx
  ON bms.automation_rules (source_template_id);

RESET ROLE;
