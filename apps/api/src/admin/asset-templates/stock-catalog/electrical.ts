import { ELECTRICAL_APFC } from "./electrical-apfc";
import { ELECTRICAL_DG_SET } from "./electrical-dg-set";
import { ELECTRICAL_FEEDER } from "./electrical-feeder";
import { ELECTRICAL_SOLAR_PV } from "./electrical-solar-pv";
import { ELECTRICAL_TRANSFORMER } from "./electrical-transformer";
import { ELECTRICAL_UPS } from "./electrical-ups";
import type { StockAssetTemplateEntry } from "./types";

/**
 * `F2.12` — the electrical pack index. `F2.13` shipped `electrical-feeder.ts`;
 * this row splits the pack into one module per class (Task 1), because the
 * five remaining classes push a single `electrical.ts` well past the §4.5
 * 1000-line cap (plan §4.3: ~1550-1800 projected lines). This file
 * aggregates; it authors nothing. **All six class modules are authored and
 * listed** — the feeder by `F2.13`, and the transformer, DG set, UPS, solar PV
 * and APFC by `F2.12` Tasks 4-8 in that order. A seventh pack
 * (`water.ts` for `E5.1`, `mechanical.ts` for `E5.2`, `facility.ts` for
 * `E5.3`) is aggregated by `stock-catalog.ts`, not by this file.
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
 * module's docblock. `electrical-dg-set` — `F2.12` Task 5, §3: 38 points
 * (21 core + 15 extended + 2 derived), 13 alarms, 1 KPI, 5 maintenance plans;
 * §3 declares every one of its 36 rows, has no `M` column at all, and embeds
 * its own `gen_*` metering — which is why its `overload` alarm binds `gen_kw`
 * where the transformer has nothing to bind. `electrical-ups` — `F2.12`
 * Task 6, §4: 31 points (12 core + 16 extended + 1 manual + 2 derived), 12
 * alarms, NO KPI key at all, 4 maintenance plans; it carries the one point key
 * the tag list does not name (`cell_voltage_spread_v`, plan §12 ruling 2), the
 * only two `safetyCritical` plans in the pack, and `load_pct` as a measured
 * core point where three other classes defer the same code.
 * `electrical-solar-pv` — `F2.12` Task 7, §5: 26 points (9 core + 15 extended
 * + 1 manual + 1 derived), 7 alarms, 1 KPI, 4 maintenance plans; §5's
 * `grid_export_kw` is not declared (the point of connection is another asset's
 * §1 meter) and two of its alarm bullets are deferred, each reasoned in that
 * module's docblock. `electrical-apfc` — `F2.12` Task 8, §6: 14 points (4 core
 * + 10 extended), 6 alarms, 1 KPI (`pf_gap`, with no `unit` key — power factor
 * is dimensionless), 3 maintenance plans; the only class with **no derived
 * point at all**, because all four of §6's derived codes need a rated kVAr per
 * step, a tariff band, a time window or trigonometry.
 *
 * **PACK TOTALS after `F2.12`**: 6 entries, 172 points, 64 alarms, 5 KPIs and
 * 21 maintenance plans. The three anti-vacuity bounds in
 * `tests/f2.13-asset-stock-catalog-vocabulary.test.ts` are read off these files
 * and moved with them.
 */
export const ELECTRICAL_STOCK_ASSET_TEMPLATES: readonly StockAssetTemplateEntry[] = [
  // Tag-list section order — §1 through §6, and the order GET /stock lists in.
  ELECTRICAL_FEEDER,
  ELECTRICAL_TRANSFORMER,
  ELECTRICAL_DG_SET,
  ELECTRICAL_UPS,
  ELECTRICAL_SOLAR_PV,
  ELECTRICAL_APFC,
];
