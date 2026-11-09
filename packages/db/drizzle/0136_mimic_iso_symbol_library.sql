-- F4.345 / ADR 0121 decisions 1, 3 and 4 — the built-in isometric symbol library (`iso`).
--
-- 1. ONE LIBRARY ROW in `bms.mimic_symbol_libraries`, exactly the registry's eighth entry in
--    `packages/shared/src/mimic-symbol-libraries/index.ts` (sort_order 80; fill style: each line
--    of a glyph is a thin filled ribbon, 1/40 of the glyph). A global library with no
--    `bms.mimic_library_settings` row is enabled, so every organization sees it on deploy; an
--    organization admin can turn it off (decision 4).
--
-- 2. THE SYMBOL ROWS, 50 iso: the 29 core symbols' isometric twins, the flow meter, the RTU panel
--    and 19 equipment kinds. GENERATED ROWS, pasted from
--      node scripts/mimic-symbols/sources/iso/build.mjs
--      node scripts/mimic-symbols/generate.mjs --iso scripts/mimic-symbols/sources/iso/out/fill --sql-rows iso
--    then frozen like every committed migration: a later glyph change is a new migration. The rows
--    are the generated keys, labels and groups in curation order (`curation/iso.json`),
--    sort_order = 10 × position. `tests/f4.345-iso-symbol-library.test.ts` compares them with the
--    shared and the web generated modules, both ways. Bare ON CONFLICT DO NOTHING (no arbiter),
--    for the 0030/0034/0051 reason.
--
-- WHO RUNS WHAT. Both INSERTs run inside `SET ROLE bms_owner`, the role that owns both tables
-- (`0090`), so `0041`'s default privileges and `0090`'s tenant revoke already cover the new rows:
-- privileges are per table, not per row. Neither table has row security, so no tenant GUC is
-- needed. Nothing in this file changes a table, a privilege or a policy. The `DO $$` block
-- asserts the effect, per the 0059/0085/0090/0092 idiom, so a silent ON CONFLICT no-op cannot pass
-- as success.

SET ROLE bms_owner;

INSERT INTO bms.mimic_symbol_libraries (code, label, source, version, licence, attribution_url, style, sort_order) VALUES
  ('iso', 'Isometric', 'Own work: scripts/mimic-symbols/sources/iso', '1', 'Own work; anatomy kit MIT', 'https://github.com/wheresryan22/anatomy', 'fill', 80)
ON CONFLICT DO NOTHING;

INSERT INTO bms.mimic_symbols (key, library_code, label, group_code, sort_order) VALUES
  ('iso:tank', 'iso', 'Storage tank', 'water', 10),
  ('iso:clarifier', 'iso', 'Clarifier', 'water', 20),
  ('iso:membrane', 'iso', 'Membrane skid', 'water', 30),
  ('iso:vessel', 'iso', 'Pressure vessel', 'water', 40),
  ('iso:tower', 'iso', 'Cooling tower', 'water', 50),
  ('iso:aeration', 'iso', 'Aeration basin', 'water', 60),
  ('iso:dosing', 'iso', 'Dosing skid', 'water', 70),
  ('iso:pump', 'iso', 'Centrifugal pump', 'water', 80),
  ('iso:discharge', 'iso', 'Discharge outfall', 'water', 90),
  ('iso:valve', 'iso', 'Gate valve', 'water', 100),
  ('iso:filter', 'iso', 'Pressure filter', 'water', 110),
  ('iso:flowmeter', 'iso', 'Flow meter', 'water', 120),
  ('iso:butterfly-valve', 'iso', 'Butterfly valve', 'water', 130),
  ('iso:check-valve', 'iso', 'Check valve', 'water', 140),
  ('iso:strainer', 'iso', 'Y-strainer', 'water', 150),
  ('iso:submersible-pump', 'iso', 'Submersible pump', 'water', 160),
  ('iso:bar-screen', 'iso', 'Bar screen', 'water', 170),
  ('iso:filter-press', 'iso', 'Filter press', 'water', 180),
  ('iso:horizontal-tank', 'iso', 'Horizontal tank', 'water', 190),
  ('iso:transformer', 'iso', 'Transformer', 'electrical', 200),
  ('iso:breaker', 'iso', 'Circuit breaker', 'electrical', 210),
  ('iso:switchboard', 'iso', 'Switchboard', 'electrical', 220),
  ('iso:generator', 'iso', 'Generator set', 'electrical', 230),
  ('iso:meter', 'iso', 'Energy meter', 'electrical', 240),
  ('iso:solar-panel', 'iso', 'Solar PV array', 'electrical', 250),
  ('iso:wind-turbine', 'iso', 'Wind turbine', 'electrical', 260),
  ('iso:ev-charger', 'iso', 'EV charger', 'electrical', 270),
  ('iso:capacitor-bank', 'iso', 'Capacitor bank', 'electrical', 280),
  ('iso:isolator', 'iso', 'Isolator', 'electrical', 290),
  ('iso:vfd', 'iso', 'Variable frequency drive', 'electrical', 300),
  ('iso:ups', 'iso', 'UPS', 'it_ups', 310),
  ('iso:battery', 'iso', 'Battery string', 'it_ups', 320),
  ('iso:rack', 'iso', 'Equipment rack', 'it_ups', 330),
  ('iso:rtu', 'iso', 'RTU panel', 'it_ups', 340),
  ('iso:chiller', 'iso', 'Chiller', 'hvac', 350),
  ('iso:ahu', 'iso', 'Air handling unit', 'hvac', 360),
  ('iso:fan', 'iso', 'Axial fan', 'hvac', 370),
  ('iso:damper', 'iso', 'Air damper', 'hvac', 380),
  ('iso:heat-exchanger', 'iso', 'Plate heat exchanger', 'hvac', 390),
  ('iso:condensing-unit', 'iso', 'Condensing unit', 'hvac', 400),
  ('iso:motor', 'iso', 'Electric motor', 'mechanical', 410),
  ('iso:compressor', 'iso', 'Air compressor', 'mechanical', 420),
  ('iso:boiler', 'iso', 'Boiler', 'mechanical', 430),
  ('iso:blower', 'iso', 'Centrifugal blower', 'mechanical', 440),
  ('iso:sensor', 'iso', 'Sensor / transmitter', 'environment', 450),
  ('iso:smoke-detector', 'iso', 'Smoke detector', 'environment', 460),
  ('iso:pressure-gauge', 'iso', 'Pressure gauge', 'environment', 470),
  ('iso:lamp', 'iso', 'Light fitting', 'facility', 480),
  ('iso:lift', 'iso', 'Lift', 'facility', 490),
  ('iso:unit', 'iso', 'Package unit', 'general', 500)
ON CONFLICT DO NOTHING;

RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM bms.mimic_symbol_libraries WHERE active) <> 8 THEN
    RAISE EXCEPTION 'migration 0136: expected 8 active symbol libraries';
  END IF;
  IF (SELECT count(*) FROM bms.mimic_symbols WHERE library_code = 'iso' AND active) <> 50 THEN
    RAISE EXCEPTION 'migration 0136: expected 50 active iso symbols';
  END IF;
  -- has_table_privilege follows role membership, so a write privilege bms_tenant inherits from
  -- another role is caught here (the 0085/0090 shape).
  IF has_table_privilege('bms_tenant', 'bms.mimic_symbols', 'INSERT') THEN
    RAISE EXCEPTION 'migration 0136: bms_tenant holds INSERT on bms.mimic_symbols';
  END IF;
  IF NOT has_table_privilege('bms_tenant', 'bms.mimic_symbols', 'SELECT') THEN
    RAISE EXCEPTION 'migration 0136: bms_tenant cannot read bms.mimic_symbols';
  END IF;
END $$;
