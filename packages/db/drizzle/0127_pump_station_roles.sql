-- 0127 — two role codes for the pump-station mimics, and the PHE memberships that take them.
--
-- `F4.319`, ADR 0113 decisions 3 and 4 (owner rulings Q3 and Q4, 2026-11-06). Plan:
-- `docs/plans/f4.319-pump-station-mimic-presets.md`.
--
-- WHAT THIS AMENDS. The header of `0060` records the 2026-09-02 ruling "ONE `pump` CODE, NOT
-- TWO". ADR 0113 reverses it: the twelve chlorine pumps (`PHE-PUMP-C-*`) take a new code
-- `dosing-pump`, and the twelve main pumps (`PHE-PUMP-M-*`) keep `pump`. A mimic node binds one
-- role, so with one shared role a node could not show the main pumps alone (ADR 0113 Context,
-- gap 1). `0060` is not edited: it is applied history.
--
-- THE SECOND CODE. The twelve RTU-health units (`PHE-AIRSP1051M-*`, `battery_charge_pct`,
-- `network_strength`, `controller_power_status`) take `rtu-controller` (ruling Q4). `0060` kept
-- them unroled because no widget asked for them; the `pump_station_overview` and
-- `pump_station_environment` presets now do.
--
-- SORT ORDER. `0060` appended `meter` 170 and `pump` 180 to the Electrical band, and `0089` took
-- 190 (`dg-set`). The Water band starts at 210. So 195 and 200: both stay in the Electrical band,
-- after the codes already there, and neither claims a position in a train. (ADR 0113 drafted 190
-- and 200; the plan moves the first, because 190 is taken.)
--
-- LABELS ARE PLURAL, the `0051` convention: the code names one asset, the label the tile.
--
-- BARE `ON CONFLICT DO NOTHING`, no conflict target, for the reason `0030`, `0034`, `0051` and
-- `0060` give: a named arbiter would let a collision on another unique constraint abort the
-- whole transaction on a re-run.
--
-- ADR 0045 / AGENTS.md §4.4 — THE ROLE. The INSERT runs as `bms_owner`, which owns
-- `bms.asset_roles` (`0051`); `RESET ROLE` closes the bracket so drizzle's journal INSERT does not
-- run as `bms_owner`. The two membership UPDATEs run AFTER `RESET ROLE`, as the connecting
-- superuser, the way `0120` updates `bms.dashboard_widgets`: `bms.asset_group_members` is FORCE
-- RLS keyed on the tenant GUC, so as `bms_owner` with no GUC they would match no row and pass as
-- a silent no-op. They must reach every organization's rows, and the asset code is the filter.
SET ROLE bms_owner;

INSERT INTO bms.asset_roles (code, label, sort_order) VALUES
  ('dosing-pump',    'Dosing pumps',    195),
  ('rtu-controller', 'RTU controllers', 200)
ON CONFLICT DO NOTHING;

-- The migration asserts its own effect (the `0059`/`0060` idiom): `ON CONFLICT DO NOTHING` reports
-- success when it wrote nothing, and a code re-inserted over a retired row would be skipped.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM bms.asset_roles WHERE code = 'dosing-pump' AND active = true
  ) THEN
    RAISE EXCEPTION 'migration 0127: bms.asset_roles has no active row for code ''dosing-pump''';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM bms.asset_roles WHERE code = 'rtu-controller' AND active = true
  ) THEN
    RAISE EXCEPTION 'migration 0127: bms.asset_roles has no active row for code ''rtu-controller''';
  END IF;
END $$;

RESET ROLE;

-- ADR 0113 decision 4 — the chlorine pumps move to `dosing-pump`, but ONLY in the seeded
-- `electrical` group and ONLY while their role is still `pump`, the value the seed wrote. Any
-- other role an administrator set (through the `F3.37` picker) is left alone, and so is a
-- membership in a group an administrator made. An administrator who chose `pump` on purpose in
-- the seeded group cannot be told apart from the seed's value; ADR 0113 accepts that. The seed
-- cannot make this move itself: it writes a role only while it is NULL (`COALESCE`,
-- `packages/db/src/asset-groups-seed.ts`). Matched on the asset code, as the seed's
-- `demoRoleForAsset` is. A second run finds no `pump` row on a `PHE-PUMP-C-` asset: a no-op.
UPDATE bms.asset_group_members AS agm
   SET role = 'dosing-pump'
  FROM bms.assets AS a, bms.asset_groups AS ag
 WHERE a.id = agm.asset_id
   AND ag.id = agm.asset_group_id
   AND ag.code = 'electrical'
   AND a.code LIKE 'PHE-PUMP-C-%'
   AND agm.role = 'pump';

-- The RTU-health units take `rtu-controller` in the seeded `environment` group where their role
-- is NULL, which is the row the seed would fill; a role an administrator set stays, and a group
-- an administrator made is not touched. A second run finds no NULL row: a no-op. (The
-- `pump-station` group does not exist yet on a database this runs on: the seed makes it.)
UPDATE bms.asset_group_members AS agm
   SET role = 'rtu-controller'
  FROM bms.assets AS a, bms.asset_groups AS ag
 WHERE a.id = agm.asset_id
   AND ag.id = agm.asset_group_id
   AND ag.code = 'environment'
   AND a.code LIKE 'PHE-AIRSP1051M-%'
   AND agm.role IS NULL;
