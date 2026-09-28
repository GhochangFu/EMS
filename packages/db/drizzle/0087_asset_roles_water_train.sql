-- F3.32 v1 / ADR 0079 decision 5, Q3 ruling — the seven `water_train` role codes.
--
-- Shape follows `0060_asset_role_estate_shapes.sql`: append to `bms.asset_roles`,
-- `SET ROLE bms_owner` (the default-privileges reason `0051`'s header gives —
-- `bms_owner` owns this table from `0051`, and `pnpm db:migrate` connects as
-- the superuser, so without the bracket a fresh row would be invisible to
-- `bms_tenant`/`bms_fleet`), bare `ON CONFLICT DO NOTHING` (no arbiter, for the
-- `0030`/`0034`/`0051` reason: a named target would abort the whole statement
-- on an unrelated collision on re-run), and a `DO $$` self-check so a silent
-- no-op cannot pass as success (the `0059`/`0060` idiom).
--
-- SEVEN CODES, NOT EIGHT. ADR 0079 decision 5: the `water_train` preset's
-- cooling-tower node reuses the existing `utilities` code (`0051`), so no
-- eighth code is inserted here.
--
-- CODES KEEP THE ADR SPELLING (owner ruling 3, plan §7): `water_intake` and
-- `water_storage`, not `intake`/`storage` — this repository's `intake` already
-- names a `bms.water_balance_roles` code (`0080`, `water-plant-demo-seed.ts`),
-- a different vocabulary from the membership role this table holds, and a
-- second `intake` here would read as the same thing under `bms.asset_roles`
-- and `bms.water_balance_roles` sharing one word for two meanings.
--
-- SORT ORDER APPENDS TO THE BANDS `0051`/`0060` already state: Water 210-250
-- (`0051` used all five slots: 210, 220, 230, 240, 250 — this file's Water
-- codes therefore start past that band's ceiling rather than inside it,
-- because inserting between existing water codes would claim an ordering
-- among them this file does not have grounds for), STP 310-360 (`0051` used
-- 310-360 in steps of ten across six rows; 370 is the next free slot), ETP
-- 410-440 (`0051` used 410-440 across four rows; 450 is next free). This
-- mirrors `0060`'s own rule: "appending claims only that they are Water/STP/
-- ETP, which is what was measured" — not a position among the existing rows.
--
-- LABELS follow `0051`'s convention (the code names what one asset is, the
-- label names what the tile shows) and the ADR's own node names.
--
-- This insert joins nothing `pnpm db:seed` creates, so it is safe inside
-- `db:migrate`, which always runs first. Do not add a mirror seeding path to
-- `seed.ts` — `water-mimic-demo-seed.ts` only ASSIGNS these codes to
-- memberships, it never inserts a `bms.asset_roles` row.

SET ROLE bms_owner;

INSERT INTO bms.asset_roles (code, label, sort_order) VALUES
  ('water_intake',   'Water Intake',   260),
  ('wtp',            'WTP',            270),
  ('ro',             'RO',             280),
  ('softener',       'Softener',       290),
  ('water_storage',  'Water Storage',  300),
  ('stp',            'STP',            370),
  ('etp',            'ETP',            450)
ON CONFLICT DO NOTHING;

-- The migration asserts its own effect, per the `0059`/`0060` idiom:
-- `ON CONFLICT DO NOTHING` is silent by construction and would otherwise hide
-- a code that never landed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'water_intake' AND active = true) THEN
    RAISE EXCEPTION 'migration 0087: bms.asset_roles has no active row for code ''water_intake''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'wtp' AND active = true) THEN
    RAISE EXCEPTION 'migration 0087: bms.asset_roles has no active row for code ''wtp''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'ro' AND active = true) THEN
    RAISE EXCEPTION 'migration 0087: bms.asset_roles has no active row for code ''ro''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'softener' AND active = true) THEN
    RAISE EXCEPTION 'migration 0087: bms.asset_roles has no active row for code ''softener''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'water_storage' AND active = true) THEN
    RAISE EXCEPTION 'migration 0087: bms.asset_roles has no active row for code ''water_storage''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'stp' AND active = true) THEN
    RAISE EXCEPTION 'migration 0087: bms.asset_roles has no active row for code ''stp''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'etp' AND active = true) THEN
    RAISE EXCEPTION 'migration 0087: bms.asset_roles has no active row for code ''etp''';
  END IF;
END $$;

RESET ROLE;
