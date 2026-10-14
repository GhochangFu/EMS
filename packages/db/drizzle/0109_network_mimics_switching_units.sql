-- F3.80 / ADR 0101 — network mimics with switching units: the `is_switching`
-- layout-unit flag, eight position role codes and the five-tone state CHECK.
--
-- 1. `bms.mimic_layout_nodes.is_switching`, `boolean NOT NULL DEFAULT false`, and
--    a second named CHECK `mimic_layout_nodes_switching_units_check` — only a
--    unit may switch. `0097`'s `mimic_layout_nodes_flags_units_check` stays as
--    it is, so a refusal names the constraint that fired.
--
-- 2. Eight role codes in the `0095`/`0097` idiom. Sort orders sit in free slots
--    between the electrical band and `utilities` (161-165), after `distribution`
--    (265, 266; 260 is `water_intake`) and after `secondary-pump` (570).
--
-- 3. `point_key_states_tone_check` restated as the five tones. The two new tones,
--    `flowing` and `shut`, are harmless while no row uses them. The rows and the
--    `valve_open` / `damper_open` point keys are seed-owned, not written here
--    (owner ruling OQ2 (b), 2026-10-15): the catalog row may not exist yet when a
--    migration runs, the `0097` reason.
--
-- NO POLICY CHANGE. The step adds a column, not rows: the two policy legs of
-- `bms.mimic_layout_nodes` stay byte-identical, and the DEFAULT backfills every
-- existing row without a write that a FORCE-RLS policy would filter. No GRANT.
--
-- Forward-only and idempotent. No statement-breakpoint markers (the `0038`
-- reason: drizzle splits on the raw string, even inside a comment).

SET ROLE bms_owner;

ALTER TABLE bms.mimic_layout_nodes
  ADD COLUMN IF NOT EXISTS is_switching boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mimic_layout_nodes_switching_units_check'
      AND conrelid = 'bms.mimic_layout_nodes'::regclass
  ) THEN
    ALTER TABLE bms.mimic_layout_nodes
      ADD CONSTRAINT mimic_layout_nodes_switching_units_check CHECK (kind = 'unit' OR is_switching = false);
  END IF;
END $$;

INSERT INTO bms.asset_roles (code, label, sort_order) VALUES
  ('ht-incomer-breaker',  'HT Incomer Breakers',  161),
  ('ht-outgoing-breaker', 'HT Outgoing Breakers', 162),
  ('bus-coupler',         'Bus Couplers',         163),
  ('isolator',            'Isolators',            164),
  ('dg-breaker',          'DG Breakers',          165),
  ('isolation-valve',     'Isolation Valves',     265),
  ('control-valve',       'Control Valves',       266),
  ('damper',              'Dampers',              570)
ON CONFLICT DO NOTHING;

ALTER TABLE bms.point_key_states DROP CONSTRAINT IF EXISTS point_key_states_tone_check;

ALTER TABLE bms.point_key_states
  ADD CONSTRAINT point_key_states_tone_check CHECK (tone IN ('closed', 'open', 'tripped', 'flowing', 'shut'));

-- The migration asserts its own effect, per the `0059`/`0095`/`0097` idiom: ON
-- CONFLICT DO NOTHING is silent by construction and would hide a row that never landed.
DO $$
DECLARE
  wanted text;
BEGIN
  FOREACH wanted IN ARRAY ARRAY['ht-incomer-breaker', 'ht-outgoing-breaker', 'bus-coupler', 'isolator', 'dg-breaker', 'isolation-valve', 'control-valve', 'damper'] LOOP
    IF NOT EXISTS (SELECT 1 FROM bms.asset_roles r WHERE r.code = wanted AND r.active = true) THEN
      RAISE EXCEPTION 'migration 0109: bms.asset_roles has no active row for code ''%''', wanted;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mimic_layout_nodes_switching_units_check'
      AND conrelid = 'bms.mimic_layout_nodes'::regclass
  ) THEN
    RAISE EXCEPTION 'migration 0109: mimic_layout_nodes_switching_units_check does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'point_key_states_tone_check'
      AND conrelid = 'bms.point_key_states'::regclass
  ) THEN
    RAISE EXCEPTION 'migration 0109: point_key_states_tone_check does not exist';
  END IF;
END $$;

RESET ROLE;
