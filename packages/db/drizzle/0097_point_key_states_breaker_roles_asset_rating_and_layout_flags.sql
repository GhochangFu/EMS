-- F3.74 / ADR 0088 — live breaker state on the electrical mimic: the state map
-- table, the five breaker role codes, two asset fields and two layout-unit flags.
--
-- 1. `bms.point_key_states` maps one value of one point key to a label and a
--    tone: `breaker_main` 0 is OPEN, 1 is CLOSED; `breaker_trip` 1 is TRIPPED.
--    Global master data like `bms.point_keys` (0057): no `organization_id`, no
--    policy, no FORCE. The rows are seed-owned
--    (`packages/db/src/point-key-states-seed.ts`), not written here — the point
--    keys themselves are written by the seed, so a migration row would reference
--    a catalog row that may not exist yet. The tone list restates
--    `pointKeyStateToneSchema` (`packages/shared/src/contracts/point-key-states.ts`);
--    SQL has no imports, so `tests/f3.74-point-key-states-schema.test.ts`
--    compares the two. `UNIQUE (point_key_code, value)` is the map's key.
--
--    The write verbs are REVOKEd from `bms_tenant` (0059's reason): `0041`'s
--    default privileges grant every verb on every `bms` table, and with no
--    policy the grant is the control. SELECT survives, because every tenant
--    reads the map. The revoke runs as `bms_owner`, the grantor — a superuser
--    issuing it removes nothing and reports success.
--
-- 2. Five role codes in the `0095` idiom, sort 151-155 — the free slots between
--    0051's electrical band (110-160, step 10) and 0060's `meter` 170.
--
-- 3. `bms.assets.rating` and `bms.assets.trip_cause`, both nullable text. No
--    backfill here: the seed fills the demo breakers.
--
-- 4. `bms.mimic_layout_nodes.fan_out` and `.is_source`, both `boolean NOT NULL
--    DEFAULT false`, and `mimic_layout_nodes_flags_units_check` — only a unit
--    may carry either flag.
--
-- NO POLICY CHANGE. Step 4 adds columns, not rows: the two policy legs of
-- `bms.mimic_layout_nodes` stay byte-identical, and the DEFAULT backfills every
-- existing row without a write that a FORCE-RLS policy would filter (the 0085
-- trap does not apply). `bms.point_key_states` is global vocabulary, so it has
-- no policy to add. No GRANT: the default privileges cover every verb, and the
-- one REVOKE above narrows them.
--
-- Forward-only and idempotent. No statement-breakpoint markers (the `0038`
-- reason: drizzle splits on the raw string, even inside a comment).

SET ROLE bms_owner;

CREATE TABLE IF NOT EXISTS bms.point_key_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  point_key_code varchar(128) NOT NULL REFERENCES bms.point_keys(code) ON DELETE CASCADE,
  value double precision NOT NULL,
  label varchar(64) NOT NULL,
  tone varchar(16) NOT NULL,
  CONSTRAINT point_key_states_tone_check CHECK (tone IN ('closed', 'open', 'tripped')),
  CONSTRAINT point_key_states_code_value_key UNIQUE (point_key_code, value)
);

REVOKE INSERT, UPDATE, DELETE ON bms.point_key_states FROM bms_tenant;

INSERT INTO bms.asset_roles (code, label, sort_order) VALUES
  ('main-breaker',         'Main Breakers',         151),
  ('ups-input-breaker',    'UPS Input Breakers',    152),
  ('ups-output-breaker',   'UPS Output Breakers',   153),
  ('load-feeder-breaker',  'Load Feeder Breakers',  154),
  ('mains-feeder-breaker', 'Mains Feeder Breakers', 155)
ON CONFLICT DO NOTHING;

ALTER TABLE bms.assets ADD COLUMN IF NOT EXISTS rating varchar(32);

ALTER TABLE bms.assets ADD COLUMN IF NOT EXISTS trip_cause varchar(128);

ALTER TABLE bms.mimic_layout_nodes
  ADD COLUMN IF NOT EXISTS fan_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_source boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mimic_layout_nodes_flags_units_check'
      AND conrelid = 'bms.mimic_layout_nodes'::regclass
  ) THEN
    ALTER TABLE bms.mimic_layout_nodes
      ADD CONSTRAINT mimic_layout_nodes_flags_units_check CHECK (kind = 'unit' OR (fan_out = false AND is_source = false));
  END IF;
END $$;

-- The migration asserts its own effect, per the `0059`/`0095` idiom: ON CONFLICT
-- DO NOTHING is silent by construction and would hide a row that never landed.
DO $$
DECLARE
  wanted text;
BEGIN
  FOREACH wanted IN ARRAY ARRAY['main-breaker', 'ups-input-breaker', 'ups-output-breaker', 'load-feeder-breaker', 'mains-feeder-breaker'] LOOP
    IF NOT EXISTS (SELECT 1 FROM bms.asset_roles r WHERE r.code = wanted AND r.active = true) THEN
      RAISE EXCEPTION 'migration 0097: bms.asset_roles has no active row for code ''%''', wanted;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mimic_layout_nodes_flags_units_check'
      AND conrelid = 'bms.mimic_layout_nodes'::regclass
  ) THEN
    RAISE EXCEPTION 'migration 0097: mimic_layout_nodes_flags_units_check does not exist';
  END IF;
END $$;

RESET ROLE;

-- The proof of the revoke, outside the bracket. `has_table_privilege` rather
-- than `information_schema` (0059): it follows role membership, so a privilege
-- `bms_tenant` inherits from another role is caught here.
DO $$
BEGIN
  IF has_table_privilege('bms_tenant', 'bms.point_key_states', 'INSERT')
     OR has_table_privilege('bms_tenant', 'bms.point_key_states', 'UPDATE')
     OR has_table_privilege('bms_tenant', 'bms.point_key_states', 'DELETE') THEN
    RAISE EXCEPTION 'migration 0097: bms_tenant still holds INSERT, UPDATE or DELETE on bms.point_key_states';
  END IF;

  IF NOT has_table_privilege('bms_tenant', 'bms.point_key_states', 'SELECT') THEN
    RAISE EXCEPTION 'migration 0097: bms_tenant lost SELECT on bms.point_key_states';
  END IF;
END $$;
