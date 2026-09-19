/**
 * `E4.1c` — the sustainability point-key vocabulary: the codes of the
 * `bms-calc-v3` derived points ADR 0070 decision 8 (as widened by the rulings
 * of 2026-09-19, plan §3.7) authors onto the stock catalog.
 *
 * **Source and status.** Every code below is a DERIVED template point: a
 * formula over a measured point the same entry declares, a `$key` from the
 * twelve-key parameter vocabulary migration `0074` seeds
 * (`bms.calc_parameter_keys`, ADR 0070 decision 2), and — where the quantity
 * is a "today" or "per day" one — a window read (ADR 0070 decision 5,
 * `E4.1b`). No code here is a tag-list row. Most were ledger records in
 * `stock-catalog-deferrals.spec.ts` ("needs an attribute", "needs a time
 * window") that the `E4.1a`/`E4.1b` grammar can now express; plan §3.9 counts
 * the discharges. The formula for each code is in the module the entry lives
 * in (`apps/api/src/admin/asset-templates/stock-catalog/*.ts`), and the
 * plan is `docs/plans/e4.1c-stock-sustainability-points-and-tariff-absorption.md`.
 *
 * **Why this file exists at all, and why it is not `constants.ts`.**
 * `packages/shared/src/constants.ts` is at 974 lines against AGENTS.md §4.5's
 * 1000-line cap (read WHOLE-FILE by `.githooks/pre-commit.mjs`), and the 29
 * codes of the two stock PRs would take it past the cap with a docblock.
 * `facility-point-keys.ts` is the precedent for a sibling file (`E5.3` §12
 * ruling 1): `tests/f2.13`, `tests/f3.38` and `tests/f3.39` each hold a
 * `POINT_KEY_SOURCE_RELS` list with a **per-file anti-vacuity floor**, and this
 * file is the third entry in each list.
 *
 * **Five arrays, one per domain, because `keysForDomain` takes ONE domain.**
 * `tests/f3.39`'s clash check reads one domain per ARRAY (`ARRAY_DOMAIN`),
 * so a mixed array would give a code two domains with the later
 * `keysForDomain` call silently winning. PR 2a declared the electrical and
 * water arrays; PR 2b appended the mechanical, HVAC and facility arrays.
 *
 * **A code shared with another pack keeps its FIRST domain** — the
 * `load_pct` rule (`load_pct` is already vocabulary, the UPS's measured
 * point, and the DG set authors it derived without redeclaring it).
 * `availability_pct_24h` and `starts_per_day` are declared ONCE below, under
 * `electrical`, and PR 2b's pump, lift and escalator author them without a
 * second declaration: `tests/f3.38`'s "every stock pointKey is a code the
 * point-key catalog can seed" tests membership in the UNION of the source
 * files, not the entry's own domain array, and `assertPointKeysActive` only
 * asks that the code exists and is active. One code, one meaning:
 * `availability_pct_24h` is the fraction of the trailing 24 h the asset was
 * not in its fault / trip / out-of-service state, whichever state point the
 * class declares.
 *
 * **Every code here needs a `UNIT_BY_KEY` entry in
 * `packages/db/src/point-key-units.ts`** (moved out of the seed by PR 2b, a
 * §4.5 gate), enforced by `tests/f3.39` —
 * `keysForDomain` writes `UNIT_BY_KEY[code] ?? null`, and `seedPointKeyCatalog`
 * `COALESCE`s the unit, so a missing entry seeds `NULL` once and a WRONG
 * spelling is the permanent one. The money points (`energy_cost_*`,
 * `water_cost_today`) and the counts (`*_per_day`) carry the EMPTY STRING —
 * the `pf`/`pue` spelling of "no unit" (plan Q8): money is in the
 * organization's currency (`bms.organizations.currency`, migration `0076`),
 * which is a property of the tenant and not of the code.
 *
 * **All five arrays are parsed as TEXT by three guards**, with a regex that
 * requires `export const <NAME>_POINT_KEYS = [` and an array body containing
 * no `]` character. Keep the shape: no nested bracket, no type annotation
 * between the name and the `=`.
 */
export const SUSTAINABILITY_ELECTRICAL_POINT_KEYS = [
  // electrical-feeder (v3) — sortOrder 36–41; formulas in electrical-feeder.ts
  "energy_cost_per_h", "co2_kg_per_h", "energy_cost_today",
  "co2_kg_today", "energy_saving_vs_baseline_pct", "demand_vs_contract_pct",
  // electrical-transformer (v2) — sortOrder 30
  "tap_changes_per_day",
  // electrical-dg-set (v2) — sortOrder 38–42 (load_pct is already vocabulary)
  "fuel_hours_remaining_h", "downtime_h_24h", "availability_pct_24h",
  "starts_per_day",
  // electrical-solar-pv (v2) — sortOrder 26–29
  "co2_avoided_kg_today", "performance_ratio_pct", "specific_yield_kwh_kwp_day",
  "capacity_utilization_pct",
  // electrical-apfc (v2) — sortOrder 14
  "steps_per_day",
] as const;

export type SustainabilityElectricalPointKey = (typeof SUSTAINABILITY_ELECTRICAL_POINT_KEYS)[number];

/**
 * The three water codes, ONE meaning across the six water classes ("KL of
 * inlet water today", its cost, its saving against the baseline), each
 * authored over the class's own inlet flow — plan §3.7. `water_cost_today`
 * reads `$water_tariff_per_kl`; a tenant whose inlet is not purchased water
 * (an STP's sewage influent) leaves the parameter unset — a counted
 * `parameter_unset` — or deletes the row on the imported draft.
 */
export const SUSTAINABILITY_WATER_POINT_KEYS = [
  // water-stp, water-etp, water-cooling-tower, water-wtp, water-ro,
  // water-softener (each v2) — three rows appended after each class's last point
  "kl_today", "water_cost_today", "water_saving_vs_baseline_pct",
] as const;

export type SustainabilityWaterPointKey = (typeof SUSTAINABILITY_WATER_POINT_KEYS)[number];

/**
 * The mechanical pack's and the vertical-transport pack's five codes (PR 2b,
 * plan §3.7). `duty_hours_pct_24h` supersedes the pump's un-windowed
 * `duty_hours_pct` under decision 8's `<quantity>_<window>` rule;
 * `starts_per_hour` is the pump's (a rolling `1h` over `start_count`);
 * `door_cycles_per_day`, `trips_per_day` and `out_of_service_hours_month`
 * are the lift's. The pump, lift and escalator also author
 * `availability_pct_24h` and the escalator `starts_per_day` — declared ONCE
 * above under `electrical`, never here (the `load_pct` rule). Counts carry
 * the empty-string unit; `out_of_service_hours_month` is a calendar window
 * and needs the location's time zone (`E4.1b`).
 */
export const SUSTAINABILITY_MECHANICAL_POINT_KEYS = [
  // mechanical-pump (v2) — sortOrder 20–21 (availability_pct_24h at 22 is electrical's)
  "duty_hours_pct_24h", "starts_per_hour",
  // mechanical-lift (v2) — sortOrder 81–83 (availability_pct_24h at 80 is electrical's)
  "door_cycles_per_day", "trips_per_day", "out_of_service_hours_month",
] as const;

export type SustainabilityMechanicalPointKey = (typeof SUSTAINABILITY_MECHANICAL_POINT_KEYS)[number];

/**
 * The HVAC pack's one code (PR 2b, plan §3.7): the AHU's fan energy over a
 * rolling 24 h, `sum({kw}, 24h)` — `kw` is tier X on the AHU, so an asset
 * without it refuses `missing_input`, visibly.
 */
export const SUSTAINABILITY_HVAC_POINT_KEYS = [
  // hvac-ahu (v2) — sortOrder 28
  "fan_energy_kwh_day",
] as const;

export type SustainabilityHvacPointKey = (typeof SUSTAINABILITY_HVAC_POINT_KEYS)[number];

/**
 * The facility pack's four codes (PR 2b, plan §3.7), one per class:
 * hours-in-state over a window for the fire panel (calendar month — needs
 * the location's zone), the occupancy zone and the parking level (rolling
 * 24 h), and `uptime_pct_24h`, which supersedes the BAS gateway's
 * un-windowed `uptime_pct` under decision 8's `<quantity>_<window>` rule.
 */
export const SUSTAINABILITY_FACILITY_POINT_KEYS = [
  // facility-fire-panel (v2) — sortOrder 24
  "isolation_hours_month",
  // facility-occupancy-zone (v2) — sortOrder 11
  "occupied_hours_day",
  // facility-parking-level (v2) — sortOrder 17
  "fan_hours_day",
  // facility-bas-gateway (v2) — sortOrder 13
  "uptime_pct_24h",
] as const;

export type SustainabilityFacilityPointKey = (typeof SUSTAINABILITY_FACILITY_POINT_KEYS)[number];
