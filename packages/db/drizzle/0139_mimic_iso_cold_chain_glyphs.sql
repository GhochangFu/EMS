-- F4.352 / ADR 0121 Amendment 1 decisions 1 and 2 — eight more glyphs in the built-in isometric
-- symbol library (`iso`): the telemetry tower and the network gateway (the PHE RTU signal and GSM
-- link), and six for the WBLDC cold chain (blast freezer, cold room, deep freezer, unit cooler,
-- temperature probe, refrigerated container).
--
-- THE SYMBOL ROWS, 8 iso, appended after 0136's 50: GENERATED ROWS, lines 51-58 of
--   node scripts/mimic-symbols/sources/iso/build.mjs
--   node scripts/mimic-symbols/generate.mjs --iso scripts/mimic-symbols/sources/iso/out/fill --sql-rows iso
-- (lines 1-50 equal 0136's rows), then frozen like every committed migration. sort_order is
-- 10 x position (510-580): the eight sit in suffixed curation blocks after `general`
-- (`curation/iso.json`, `"hvac#f4.352"` ...), so no earlier symbol moves.
-- `tests/f4.345-iso-symbol-library.test.ts` compares 0136's rows followed by these with the
-- shared and the web generated modules. Bare ON CONFLICT DO NOTHING (no arbiter), for the
-- 0030/0034/0051 reason. No library row: the `iso` row is 0136's and is untouched.
--
-- WHO RUNS WHAT. The INSERT runs inside `SET ROLE bms_owner`, the role that owns the table
-- (`0090`), so `0041`'s default privileges and `0090`'s tenant revoke already cover the new rows:
-- privileges are per table, not per row. The table has no row security, so no tenant GUC is
-- needed. Nothing in this file changes a table, a privilege or a policy. The `DO $$` block
-- asserts the effect, per the 0059/0085/0090/0092 idiom, so a silent ON CONFLICT no-op cannot pass
-- as success.

SET ROLE bms_owner;

INSERT INTO bms.mimic_symbols (key, library_code, label, group_code, sort_order) VALUES
  ('iso:telemetry-tower', 'iso', 'Telemetry tower', 'general', 510),
  ('iso:gateway', 'iso', 'Network gateway', 'it_ups', 520),
  ('iso:blast-freezer', 'iso', 'Blast freezer', 'hvac', 530),
  ('iso:cold-room', 'iso', 'Cold room', 'hvac', 540),
  ('iso:deep-freezer', 'iso', 'Deep freezer', 'hvac', 550),
  ('iso:unit-cooler', 'iso', 'Unit cooler', 'hvac', 560),
  ('iso:temperature-probe', 'iso', 'Temperature probe', 'environment', 570),
  ('iso:reefer', 'iso', 'Refrigerated container', 'facility', 580)
ON CONFLICT DO NOTHING;

RESET ROLE;

DO $$
BEGIN
  IF (SELECT count(*) FROM bms.mimic_symbol_libraries WHERE active) <> 8 THEN
    RAISE EXCEPTION 'migration 0139: expected 8 active symbol libraries';
  END IF;
  IF (SELECT count(*) FROM bms.mimic_symbols WHERE library_code = 'iso' AND active) <> 58 THEN
    RAISE EXCEPTION 'migration 0139: expected 58 active iso symbols';
  END IF;
  -- has_table_privilege follows role membership, so a write privilege bms_tenant inherits from
  -- another role is caught here (the 0085/0090 shape).
  IF has_table_privilege('bms_tenant', 'bms.mimic_symbols', 'INSERT') THEN
    RAISE EXCEPTION 'migration 0139: bms_tenant holds INSERT on bms.mimic_symbols';
  END IF;
  IF NOT has_table_privilege('bms_tenant', 'bms.mimic_symbols', 'SELECT') THEN
    RAISE EXCEPTION 'migration 0139: bms_tenant cannot read bms.mimic_symbols';
  END IF;
END $$;
