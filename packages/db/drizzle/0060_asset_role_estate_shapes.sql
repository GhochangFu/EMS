-- 0060 — two role codes for the shapes the estate actually holds.
--
-- `F3.40`, ADR 0051 decision 5. Migration `0051` seeded 26 codes read off the
-- client mock's five trains, and the header of that file states the rule this
-- one obeys: *"an unused role is easy to add, a wrong one is hard to retire,
-- because the foreign key in step 4 carries no ON DELETE by design."* So this
-- file adds exactly the two codes a measurement names, and no third.
--
-- WHAT WAS MEASURED, on the running stack on 2026-09-01, rather than inferred.
-- PHEWB holds four device shapes at six sites, two of each per site:
--
--     PHE-MFM        12 assets, 6 sites   16 electrical keys (kw, pf, kwh_total,
--                                         the three-phase voltage and current set)
--     PHE-PUMP-M     12 assets, 6 sites   breaker_main
--     PHE-PUMP-C     12 assets, 6 sites   chlorine_pump_on
--     PHE-AIRSP1051M 12 assets, 6 sites   battery_charge_pct, network_strength,
--                                         controller_power_status
--
-- The first is a meter and the next two are pumps. `0051`'s 26 codes name
-- positions in a substation train — incoming supply, transformer, HT and LT
-- panels, MCCs — plus the water, STP, ETP and HVAC trains. A meter is not a
-- position in a train and neither is a pump, so all six of PHEWB's electrical
-- assets per site fit nothing, which is why `packages/db/src/asset-groups-seed.ts`
-- leaves their `role` NULL rather than guessing.
--
-- ONE `pump` CODE, NOT TWO, and that is a decision rather than a shortcut.
-- `PHE-PUMP-M` and `PHE-PUMP-C` carry different points, so a reader may expect
-- `pump` and `dosing-pump`. They are the same SHAPE — a pump, with a running
-- signal — and `0051` step 4 made the junction's role index deliberately NOT
-- UNIQUE precisely so one role may match several members. ADR 0051 decision 5
-- names "a `pump`", singular, and `F3.41` binds `breaker_main` and
-- `chlorine_pump_on` on that one role. Splitting it here would commit `F3.41`
-- to a second widget before anyone has asked for one.
--
-- NOTHING FOR THE ENVIRONMENT SHAPE. `PHE-AIRSP1051M` fits no role either, and
-- it is deliberately not given one: ADR 0051 decision 5 names two shapes,
-- `F3.41`'s template is electrical, and a role added for a widget nobody has
-- specified is the "wrong one" `0051`'s header warns about. It is also the case
-- this row's write path exists for — the next shape is now a `POST`, not a
-- release.
--
-- SORT ORDER APPENDS TO THE ELECTRICAL BAND, IT DOES NOT INSERT INTO IT.
-- `0051` banded Electrical 110-160 spaced by ten, with Water starting at 210.
-- 170 and 180 are the two free slots below that boundary. Inserting at, say,
-- 115 or 155 would assert that a meter sits between the incoming supply and the
-- transformer, or a pump between the MCCs and the utilities — a claim about the
-- train that these two shapes do not make. Appending claims only that they are
-- electrical, which is what was measured.
--
-- LABELS ARE PLURAL, matching `0051`'s own ("HT Panels", "MCCs", "Chillers").
-- The code names what ONE asset is; the label names what the tile shows.
--
-- BARE `ON CONFLICT DO NOTHING`, no conflict target, for the reason `0030`,
-- `0034` and `0051` all give: a named `(code)` arbiter would let a collision on
-- some other unique constraint abort the whole transaction on a re-run.
--
-- This insert joins nothing that `pnpm db:seed` creates, so it is safe inside
-- `db:migrate`, which always runs first. Do not add a mirror seeding path to
-- `seed.ts`.
INSERT INTO bms.asset_roles (code, label, sort_order) VALUES
  ('meter', 'Meters', 170),
  ('pump',  'Pumps',  180)
ON CONFLICT DO NOTHING;

-- The migration asserts its own effect.
--
-- `ON CONFLICT DO NOTHING` is silent by construction: it reports success when
-- it wrote nothing, which is what makes it safe to re-run and also what would
-- hide a code that never landed. `0059` established this shape in this
-- repository — the statement, then a `DO` block that refuses to let a
-- no-op pass as a success.
--
-- `active` is checked as well as presence. A code re-inserted over a row this
-- row's own `PATCH` had retired would be skipped by `ON CONFLICT DO NOTHING`
-- and leave the vocabulary short, which no reader would see.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM bms.asset_roles WHERE code = 'meter' AND active = true
  ) THEN
    RAISE EXCEPTION 'migration 0060: bms.asset_roles has no active row for code ''meter''';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM bms.asset_roles WHERE code = 'pump' AND active = true
  ) THEN
    RAISE EXCEPTION 'migration 0060: bms.asset_roles has no active row for code ''pump''';
  END IF;
END $$;
