import { ELECTRICAL_FEEDER } from "./electrical-feeder";
import { ELECTRICAL_TRANSFORMER } from "./electrical-transformer";
import type { StockAssetTemplateEntry } from "./types";

/**
 * `F2.12` — the electrical pack index. `F2.13` shipped `electrical-feeder.ts`;
 * this row splits the pack into one module per class (Task 1), because the
 * five remaining classes push a single `electrical.ts` well past the §4.5
 * 1000-line cap (plan §4.3: ~1550-1800 projected lines). This file
 * aggregates; it authors nothing. `electrical-transformer.ts` joined the array
 * below when Task 4 authored it; the four remaining class modules
 * (`electrical-dg-set.ts`, `electrical-ups.ts`, `electrical-solar-pv.ts`,
 * `electrical-apfc.ts`) are still empty-but-typed placeholders — see each
 * module's own docblock — and join it only once Tasks 5-8 author them.
 *
 * **SOURCE.** `docs/electrical-derived-taglist-v1.md` §§1-6 — the v1 point
 * basis for all six electrical asset classes (ADR 0051 Amendment 6).
 *
 * **TIERS → `meta.tier`** (ADR 0040 decision 3): the tag list's `C` is
 * `core`/`required: true`; `X` is `extended`/`required: false`; `M` is
 * `manual`/`required: false` — entered by hand via `F1.8` / `F1.9`, never
 * mapped from `sourceDataKeyPattern`. **An `M` row carries
 * `sourceDataKeyPattern: null` forever, so `F1.8` manual entry has nothing to
 * attach a reading to yet** (plan §7) — a flag for `F1.8`, not fixed here.
 *
 * **DEFERRAL LEDGER.** Every derived code the tag list names that this row
 * does not author, with its reason (plan §2):
 *
 *  - `load_pct` (feeder, transformer, DG), `demand_vs_contract_pct`,
 *    `pf_penalty_flag`, `pf_penalty_hours` — each needs an asset or site
 *    attribute (rating, contract demand, tariff PF band) `bms-calc-v1` has no
 *    way to read.
 *  - `performance_ratio_pct`, `specific_yield_kwh_kwp_day`,
 *    `capacity_utilization_pct` — installed kWp, an asset attribute.
 *  - `losses_pct` — incomer − Σ feeders, a cross-asset sum.
 *  - `lv_load_pct`, `grid_export_kw` — both read a different asset's §1
 *    meter.
 *  - `hot_spot_estimate_c`, `loss_of_life_pct_day`, `duval_triangle_zone` —
 *    models the grammar has no functions for.
 *  - `tap_changes_per_day`, `starts_per_day`, `steps_per_day`,
 *    `availability_pct`, `underload_hours`, `battery_events_per_month`,
 *    `charge_cycle_count` — each needs a time window the grammar has no
 *    state for.
 *  - `fuel_hours_remaining_h` — needs the tank capacity, an attribute.
 *  - `runtime_margin_min`, `battery_age_months`, `capacitor_health_pct`,
 *    `pf_correction_kvar`, `string_current_deviation_pct`,
 *    `self_consumption_pct`, `co2_avoided_kg`, `kwh_per_unit_output`,
 *    `specific_energy_kwh_kl` — each needs an attribute, a site value, or a
 *    function the grammar does not have.
 *
 * **PROMOTED AND AUTHORED — six, not the tag list's five named** (ADR 0051
 * Amendment 6 decision 8 plus plan §12 ruling 2): `oil_rise_over_ambient_c`,
 * `specific_fuel_l_kwh`, `unplanned_run_flag`, `load_headroom_pct`,
 * `inverter_efficiency_pct`, and `cell_voltage_spread_v` — the last one
 * owner-ruled in, not named by the tag list. Formulas and reasoning:
 * `packages/shared/src/constants.ts`'s `ELECTRICAL_CLASS_POINT_KEYS`
 * docblock, and each class module that authors one.
 *
 * **KPI vs. point.** A code the tag list marks derived becomes a
 * `kind: "derived"` point when a formula exists over measured siblings in
 * the SAME entry; `content.kpis` is for a named ratio that is not itself a
 * point another row references. `cell_voltage_spread_v` moved from a planned
 * KPI to a point because the UPS's weak-block alarm needs a `pointKey` to
 * bind (plan §12 ruling 2).
 *
 * **VERSION HISTORY**, per entry, each `v1` (2026-09-02), PROVISIONAL —
 * derived from published practice, not client-confirmed: `electrical-feeder`
 * — `F2.13`, §1. `electrical-transformer` — `F2.12` Task 4, §2: 30 points
 * (9 core + 16 extended + 4 manual + 1 derived), 15 alarms, 2 KPIs, 5
 * maintenance plans; §2's `dga_lab_result` and `lv_load_pct` are not declared
 * and the class cannot express an `overload` at all, each reasoned in that
 * module's docblock. `electrical-dg-set`, `electrical-ups`,
 * `electrical-solar-pv`, `electrical-apfc` — `F2.12`, §§3-6 respectively
 * (Tasks 5-8).
 */
export const ELECTRICAL_STOCK_ASSET_TEMPLATES: readonly StockAssetTemplateEntry[] = [
  // Tag-list section order — §1, §2, then §§3-6 as Tasks 5-8 land.
  ELECTRICAL_FEEDER,
  ELECTRICAL_TRANSFORMER,
];
