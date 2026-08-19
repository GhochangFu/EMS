-- ADR 0034 — alarm enrichment schema: root cause, impact, affected assets,
-- corrective actions, energy/water/production impact, ETR, skills.
--
-- Three new tables. `bms.alarm_skills` is a fourth open vocabulary in the
-- ADR 0031/0032 shape (code/label, `INSERT`-able, not an enum) — `skill` is
-- the one field of the seven this ADR closes, because it is meant to route an
-- operator to a trade and a free-text field cannot be filtered or reported on
-- trade-wise. `bms.alarm_enrichments` is a companion table to `bms.alarms`,
-- not new columns on it, so that F3.10's pending `cleared_at` addition and
-- this migration do not touch the same table in parallel. `bms.affected
-- _assets` is a join table, matching the existing convention
-- (`asset_group_members`), not a jsonb/array column.
--
-- Forward-only and idempotent.

-- 1. The skill vocabulary, as data.
--
--    `sort_order`, not `rank`: a skill carries no urgency the way severity
--    does, and two skills may legitimately sort together. This is the
--    `bms.asset_domains` half of the ADR 0031/0032 pattern, not severity's.
--    No `tone` column either — a skill drives no styling.
CREATE TABLE IF NOT EXISTS bms.alarm_skills (
  code varchar(64) PRIMARY KEY,
  label varchar(128) NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Seed the starting trade list, owner-confirmed 2026-08-19.
--
--    Spaced by ten so a trade can be inserted between two existing ones later
--    with no renumbering, matching migration 0030's severity spacing.
--
--    Bare `ON CONFLICT DO NOTHING` — no conflict target — for the same
--    reason 0030 gives: a named `(code)` arbiter would let a collision on
--    some other unique constraint abort the whole transaction on a re-run.
--
--    Unlike migration 0033 (`8e970cf`), this insert depends on nothing that
--    `pnpm db:seed` creates — no join to `bms.assets`/`locations`/
--    `organizations` — so it is safe to run inside `db:migrate`, which always
--    runs before `db:seed`. Do not add a mirror seeding path to `seed.ts`.
INSERT INTO bms.alarm_skills (code, label, sort_order) VALUES
  ('electrical', 'Electrical', 10),
  ('mechanical', 'Mechanical', 20),
  ('hvac',       'HVAC',       30),
  ('controls',   'Controls',   40),
  ('civil',      'Civil',      50)
ON CONFLICT DO NOTHING;

-- 3. The enrichment table — one row per alarm.
--
--    `alarm_id` is UNIQUE: exactly one enrichment per alarm instance, not a
--    history of edits. An edit overwrites the row; `updated_by`/`updated_at`
--    record who/when, not a version chain.
--
--    `ON DELETE CASCADE` on `alarm_id`, unlike `bms.alarms.rule_id`'s
--    `NO ACTION` (ADR 0033 decision 5): no code deletes a `bms.alarms` row
--    today, and if that ever changes, the enrichment has no independent
--    meaning to preserve without the alarm it describes.
--
--    `skill_code` is varchar(64), matching `alarm_skills.code`'s width —
--    getting this right at creation, unlike `alarms.severity`'s original
--    varchar(32) that migration 0030 step 4 had to widen after the fact.
--    No `ON DELETE` on `skill_code`: the default NO ACTION is correct —
--    retiring a skill is `active = false`, not a delete.
CREATE TABLE IF NOT EXISTS bms.alarm_enrichments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alarm_id uuid NOT NULL UNIQUE REFERENCES bms.alarms(id) ON DELETE CASCADE,
  root_cause text,
  impact text,
  corrective_actions text,
  energy_impact text,
  water_impact text,
  production_impact text,
  etr_at timestamptz,
  skill_code varchar(64) REFERENCES bms.alarm_skills(code),
  updated_by uuid REFERENCES bms.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Affected assets — a join table, not an array column, so a deleted asset
--    cannot leave a dangling reference silently. Named constraint so `\d`
--    and the Drizzle file describe the same object under one name (the
--    `alarm_severities_rank_key` precedent).
CREATE TABLE IF NOT EXISTS bms.alarm_affected_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrichment_id uuid NOT NULL REFERENCES bms.alarm_enrichments(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES bms.assets(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alarm_affected_assets_enrichment_asset_key UNIQUE (enrichment_id, asset_id)
);

CREATE INDEX IF NOT EXISTS alarm_affected_assets_enrichment_idx
  ON bms.alarm_affected_assets (enrichment_id);
