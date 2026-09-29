-- F3.32d / ADR 0082 decisions 1 and 4 — mimic symbols and role codes for every
-- asset domain.
--
-- 1. THE SYMBOL CHECK IS RESTATED, NOT EDITED. `mimicSymbolSchema` in
--    `packages/shared/src/contracts/mimic-layouts.ts` grows from twelve members
--    to twenty-nine (the twelve water and general symbols, then seventeen for
--    the other domains, appended in ADR order). `0088_mimic_layouts.sql` is a
--    committed migration and stays frozen at the first twelve, so this file
--    drops `mimic_layout_nodes_symbol_check` and adds it again with the whole
--    list, in the enum's order. The DROP carries IF EXISTS so a database whose
--    constraint was already replaced by hand still migrates. The ADD carries no
--    IF-NOT-EXISTS guard: the drop just ran, so an ADD that fails is a real
--    fault and must abort the migration, not pass as a no-op.
--    `tests/f3.32d-mimic-domain-symbols-and-roles.test.ts` compares this list
--    to the enum source; `tests/f3.32c-mimic-layouts-schema.test.ts` compares
--    0088's list to the enum's first twelve.
--
-- 2. EIGHTEEN ROLE CODES are appended to `bms.asset_roles` in the `0087` idiom:
--    `SET ROLE bms_owner` (`bms_owner` owns this table from `0051`, and
--    `pnpm db:migrate` connects as the superuser, so without the bracket a
--    fresh row would be invisible to `bms_tenant`/`bms_fleet`), a bare
--    ON CONFLICT DO NOTHING (no arbiter, for the `0030`/`0034`/`0051` reason: a
--    named target would abort the whole statement on an unrelated collision on
--    re-run), and a `DO $$` self-check so a silent no-op cannot pass as
--    success (the `0059`/`0060` idiom). The same bracket makes `bms_owner` the
--    actor for the ALTER, as the table's owner.
--
-- SORT ORDER follows the domain bands ADR 0082 decision 4 names: Electrical
-- 190 (after `0060`'s 170 and 180), HVAC 560 (after `0051`'s 510-550), IT
-- 610-650, Mechanical 710-740, Environment 810-840, Facility 910-930.
--
-- LABELS follow `0051`'s convention: the code names what one asset is, the
-- label names what the tile shows (plural where the tile counts several).
--
-- No GRANT: `0041`'s default privileges cover the table, and a row needs none.
-- No Drizzle schema change: the CHECK list is not in the Drizzle schema, and
-- `bms.asset_roles` gains rows, not columns. No seed change (ADR 0082
-- decision 6): no demo organization gains members for the new roles.

SET ROLE bms_owner;

ALTER TABLE bms.mimic_layout_nodes DROP CONSTRAINT IF EXISTS mimic_layout_nodes_symbol_check;

ALTER TABLE bms.mimic_layout_nodes ADD CONSTRAINT mimic_layout_nodes_symbol_check CHECK (symbol IS NULL OR symbol IN ('tank', 'clarifier', 'membrane', 'vessel', 'tower', 'aeration', 'dosing', 'pump', 'discharge', 'valve', 'filter', 'unit', 'transformer', 'breaker', 'switchboard', 'generator', 'meter', 'motor', 'ups', 'battery', 'rack', 'chiller', 'ahu', 'fan', 'compressor', 'boiler', 'sensor', 'lamp', 'lift'));

INSERT INTO bms.asset_roles (code, label, sort_order) VALUES
  ('dg-set',           'DG Sets',           190),
  ('secondary-pump',   'Secondary Pumps',   560),
  ('ups',              'UPS',               610),
  ('battery',          'Batteries',         620),
  ('pdu',              'PDUs',              630),
  ('it-rack',          'IT Racks',          640),
  ('crac',             'CRAC Units',        650),
  ('air-compressor',   'Air Compressors',   710),
  ('air-dryer',        'Air Dryers',        720),
  ('air-receiver',     'Air Receivers',     730),
  ('air-header',       'Air Headers',       740),
  ('ambient-station',  'Ambient Stations',  810),
  ('indoor-air',       'Indoor Air',        820),
  ('stack-monitor',    'Stack Monitors',    830),
  ('effluent-monitor', 'Effluent Monitors', 840),
  ('lighting',         'Lighting',          910),
  ('lifts',            'Lifts',             920),
  ('fire-pump',        'Fire Pumps',        930)
ON CONFLICT DO NOTHING;

-- The migration asserts its own effect, per the `0059`/`0060`/`0087` idiom:
-- ON CONFLICT DO NOTHING is silent by construction and would otherwise hide a
-- code that never landed, and the CHECK must exist after the drop and add.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'dg-set' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''dg-set''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'secondary-pump' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''secondary-pump''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'ups' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''ups''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'battery' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''battery''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'pdu' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''pdu''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'it-rack' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''it-rack''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'crac' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''crac''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'air-compressor' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''air-compressor''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'air-dryer' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''air-dryer''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'air-receiver' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''air-receiver''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'air-header' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''air-header''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'ambient-station' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''ambient-station''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'indoor-air' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''indoor-air''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'stack-monitor' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''stack-monitor''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'effluent-monitor' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''effluent-monitor''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'lighting' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''lighting''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'lifts' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''lifts''';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bms.asset_roles WHERE code = 'fire-pump' AND active = true) THEN
    RAISE EXCEPTION 'migration 0089: bms.asset_roles has no active row for code ''fire-pump''';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'bms.mimic_layout_nodes'::regclass
       AND conname = 'mimic_layout_nodes_symbol_check'
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'migration 0089: bms.mimic_layout_nodes has no mimic_layout_nodes_symbol_check';
  END IF;
END $$;

RESET ROLE;
