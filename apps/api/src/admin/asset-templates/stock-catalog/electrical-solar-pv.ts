import { CORE, derived, EXTENDED, MANUAL, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The electrical pack's solar-PV class — `F2.12` Task 7, ADR 0052
 * decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/electrical-derived-taglist-v1.md` §5 — *"Solar PV —
 * grid-tied inverter with plant sensors"*, whose rows are *"SunSpec Model 103
 * fields, plus Model 303 irradiance and the module temperature that PR needs"*.
 * §5's 26 table rows less the one below, **in the document's own order**
 * (`sortOrder` 0…24), then the one derived code — **26 points: 9 core + 15
 * extended + 1 manual + 1 derived**, 7 alarms, 1 KPI, 4 maintenance plans.
 *
 * **§5's TABLE INTERLEAVES THE TIERS, and the order here is the table's.**
 * `inv_event_code` (X) is row 3, ahead of four C rows; the six `ac_voltage_*` /
 * `ac_current_*` X rows sit between `ac_frequency_hz` and `energy_total_kwh`,
 * both C. Plan §5.4 lists them grouped core-then-extended, which describes the
 * tiers and not the order.
 *
 * **PROVISIONAL — derived from published practice, not client-confirmed**, and
 * the entry's own `description` says so (decision 6; there is no
 * `meta.provenance`). Plan §12 ruling 1 ships the maintenance plans and the KPI
 * code on that footing — **the tag list has no maintenance section and names no
 * KPI code** — so the derivation basis is recorded here the way the tag list
 * records its own at the top:
 *
 *  - **String I–V practice** — a curve trace and a combiner-box inspection per
 *    string is the field check for the open string, the failed bypass diode and
 *    the mismatched module. It is the manual version of the deferred
 *    `string_current_deviation_pct`, and it exists as a plan precisely because
 *    that code is not expressible here.
 *  - **Thermography practice** — an annual thermal scan of the DC and AC
 *    terminations. A loose termination is the failure that precedes a combiner
 *    fire, and it is invisible to every point in this table.
 *  - **Soiling practice** — the cleaning interval is genuinely site-specific
 *    (dust load, bird load, monsoon), so the 30-day figure below is a starting
 *    point a site adjusts, and `soiling_loss_pct` is the hand record that tells
 *    it which way.
 *
 * The asymmetry that makes authoring this safe: **a KPI code is per-entry
 * template content, changeable by a version bump; a point key is seeded into
 * `bms.point_keys`, foreign-keyed by `0058` and permanent.** This entry invents
 * no point key. `inverter_efficiency_pct` is not invented — §5's `Derived:`
 * line names it (*"AC ÷ DC"*) and ADR 0051 Amendment 6 decision 8
 * pre-authorized promoting it.
 *
 * ---
 *
 * **ONE OF §5's 26 ROWS IS DELIBERATELY NOT DECLARED.**
 *
 *  - **`grid_export_kw`** (in-table `D`) — §5 says in the row itself that it is
 *    measured *"at the point of connection (§1 meter)"*, which is a **different
 *    asset**, and `bms-calc-v1` cannot name a cross-asset value. Net export on
 *    a site is the export meter's own feeder/incomer template beside this one,
 *    never an invented row here. `electrical-classes-2.spec.ts` asserts the
 *    absence with that reason, so the next author who "completes" §5's table
 *    from the document fails at build time rather than at a customer's import.
 *
 * **`energy_today_kwh` IS TIER `C/D` AND IS AUTHORED MEASURED** — the same
 * ruling `kwh_today` took on the feeder and `health_pct` takes on the UPS. No
 * `bms-calc-v1` formula expresses energy-today: it needs a midnight boundary
 * and a running total, and the grammar has no time and no state. The inverter
 * reports it, so it is declared as what it is. A placeholder formula would be
 * the guessing ADR 0036 refuses.
 *
 * **THE DEFERRED DERIVED CODES**, each with the reason it is named rather than
 * placeholdered (ADR 0051 Amendment 6 decision 8: a code with no formula is not
 * vocabulary). §5 names seven prose codes plus the in-table `grid_export_kw`;
 * one is authored below and seven are deferred:
 *
 *  - `grid_export_kw` — another asset's §1 meter (above).
 *  - `performance_ratio_pct` = yield ÷ (irradiance × capacity) — the installed
 *    **kWp** is an asset attribute.
 *  - `specific_yield_kwh_kwp_day` — kWp again, and a daily window.
 *  - `capacity_utilization_pct` — kWp again.
 *  - `string_current_deviation_pct` — needs the **whole set** of string
 *    currents, where §5 declares one `string_current_a` key. A deviation over
 *    one value is not a deviation.
 *  - `self_consumption_pct` — the site load, on other assets.
 *  - `co2_avoided_kg` — `E4.2`'s figure, and it needs a grid emission factor.
 *
 * **THE ONE AUTHORED FORMULA.** `inverter_efficiency_pct` =
 * `{ac_power_kw} / {dc_power_kw} * 100`, `streaming`, default input age (the
 * inverter publishes both on one SunSpec poll). **It is undefined at night**,
 * when `dc_power_kw` is zero, and that is handled rather than guarded:
 * `evaluate.ts` returns `non_finite` for any node whose result fails
 * `Number.isFinite`, so the engine produces **no value** for that reading and
 * the skip is visible in its own count. **Do not add a `clamp` or a
 * `max(…, 0.001)`**: a fabricated denominator turns an inverter that is asleep
 * into an efficiency of 0 %, which reads as a fault at 2 a.m. every night.
 *
 * **THE ONE KPI.** `module_temp_rise_c` = `{module_temp_c} - {ambient_temp_c}`.
 * Module temperature rise over ambient is what separates *"the array is hot
 * because it is a hot day"* from *"the array is hot because it is not
 * ventilating"*, and it is the input a real performance-ratio calculation
 * temperature-corrects with — the nearest thing to `performance_ratio_pct` this
 * class can honestly carry. `higherIsBetter: false`.
 *
 * **ALARMS — 7 philosophy rows, every one pair-absent** (ADR 0019 Amendment 2
 * decisions 1 and 2; B7: limit values are set per site at commissioning). §5
 * carries **seven** bullets and the arithmetic to seven rows is not 1:1 in
 * either direction: **two bullets are deferred**, the *"grid voltage /
 * frequency out of band"* bullet **splits into two**, and one row is authored
 * that no bullet names. 7 − 2 + 1 + 1 = 7. The two deferred, each named here so
 * a reader does not have to derive the absence:
 *
 *  - ***PR low vs expected*** — needs `performance_ratio_pct`, hence installed
 *    kWp, an asset attribute.
 *  - ***string current deviation high*** — needs
 *    `string_current_deviation_pct`, hence the whole string set.
 *
 * `inverter_efficiency_low` is **the nearest expressible meaning to both and is
 * a substitute for neither.** It is authored on its own merits — a failing
 * power stage or a derating condition shows in AC ÷ DC before it shows anywhere
 * else — and the two deferred bullets keep their own names in this list and in
 * the two maintenance plans that cover them by hand. Renaming a deferred alarm
 * into an expressible one is the guessing this catalog refuses.
 *
 * **THE ONE `M` ROW.** `soiling_loss_pct` reaches the platform through `F1.8`
 * manual entry / `F1.9` import, never through a data key. One consequence,
 * stated and not solved here: an `M` row carries `sourceDataKeyPattern: null`
 * forever, so `AssetTemplateInstantiationService` lists it in `skippedPoints`
 * and it **never gets an `asset_points` row** — which means `F1.8` has nothing
 * to attach a reading to yet. A flag for `F1.8`; it is a manual-entry
 * data-model question, not a catalog one.
 *
 * **UNITS.** Authored from `packages/db/src/point-keys-seed.ts`'s `UNIT_BY_KEY`
 * and not from §5's Unit column, because those spellings are permanent and
 * `onboarding-commit.service.ts` refuses a client CSV that disagrees. `unit` is
 * `null` wherever `UNIT_BY_KEY` holds `""` — `inv_status`'s "enum",
 * `inv_fault`'s `0/1`, `inv_event_code`'s "code" and `ac_pf`'s dimensionless
 * "—". A template `unit` is an *override*; `null` defers to the catalog's own
 * unit. Labels drop the table's editorial remarks (`(SunSpec St enum: …)`,
 * `(per MPPT or total)`, `(pyranometer, Model 303)`, `(per string, combiner
 * box)`, `(inverter self-test)`, `(manual or soiling station)`).
 *
 * ---
 *
 * **VERSION HISTORY** (ADR 0052 decision 6): a change to a shipped entry is a
 * new `stockVersion`, recorded here, taken by an organization through a
 * re-import (decision 4), never by mutating its row.
 *
 *  - `electrical-solar-pv` **v1** (2026-09-02, `F2.12`): authored from
 *    `electrical-derived-taglist-v1.md` §5, PROVISIONAL — derived, not
 *    client-confirmed. The client-confirmed release is v2; a redline candidate
 *    is per-string metering, which would make `string_current_deviation_pct`
 *    expressible and give the deferred alarm bullet a parameter.
 */
export const ELECTRICAL_SOLAR_PV: StockAssetTemplateEntry = {
  code: "electrical-solar-pv",
  name: "Solar PV — grid-tied inverter with plant sensors",
  assetType: "solar_pv",
  domain: "electrical",
  description:
    "Grid-tied solar PV inverter in SunSpec Model 103 fields, with the Model 303 irradiance and " +
    "module-temperature sensors a performance calculation needs. Authored from " +
    "docs/electrical-derived-taglist-v1.md §5 (PROVISIONAL — derived from industry practice, not " +
    "client-confirmed). Net export at the point of connection is a §1 meter on another asset and " +
    "is not declared here. Tier C points are required, X optional, M entered by hand; alarm rows " +
    "carry a meaning and no limit.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "inverter_fault",
        pointKey: "inv_fault",
        severity: "critical",
        category: "operations",
        message:
          "Inverter fault active; the SunSpec or vendor event bits are in inv_event_code, and the " +
          "operating state is in inv_status.",
      },
      {
        code: "zero_output_with_irradiance",
        pointKey: "ac_power_kw",
        severity: "warning",
        category: "energy",
        message:
          "No AC output while irradiance_wm2 shows sun — a trip, an anti-islanding disconnection " +
          "or an isolator left open after work. The irradiance level that counts as sun is set " +
          "per site.",
      },
      {
        code: "inverter_efficiency_low",
        pointKey: "inverter_efficiency_pct",
        severity: "warning",
        category: "energy",
        message:
          "DC-to-AC conversion below the site's expected band — a failing power stage or a " +
          "derating condition. Binds the derived inverter_efficiency_pct, which is undefined at " +
          "night and produces no reading rather than a zero.",
      },
      {
        code: "cabinet_temp_high",
        pointKey: "cabinet_temp_c",
        severity: "warning",
        category: "operations",
        message:
          "Cabinet or heatsink temperature high — the inverter is about to derate and yield is " +
          "being lost before anything trips.",
      },
      {
        code: "insulation_resistance_low",
        pointKey: "insulation_resistance_kohm",
        severity: "critical",
        category: "safety",
        message: "DC insulation resistance low — an earth fault on the array.",
      },
      {
        code: "grid_frequency_out_of_band",
        pointKey: "ac_frequency_hz",
        severity: "warning",
        category: "operations",
        message:
          "Grid frequency outside the anti-islanding window — the inverter will disconnect. The " +
          "window is the grid code's and is set per site.",
      },
      {
        code: "grid_voltage_out_of_band",
        pointKey: "ac_voltage_vry",
        severity: "warning",
        category: "operations",
        message:
          "Grid voltage outside the anti-islanding window. Binds the R–Y line voltage, an X-tier " +
          "row — legal, because an alarm needs the key to be declared and not required.",
      },
    ],
    kpis: [
      {
        // The nearest thing to a performance ratio this class can honestly
        // carry: PR itself needs the installed kWp and is deferred.
        code: "module_temp_rise_c",
        name: "Module temperature rise over ambient",
        unit: "°C",
        pointKeys: ["module_temp_c", "ambient_temp_c"],
        expression: "{module_temp_c} - {ambient_temp_c}",
        dialect: "bms-calc-v1",
        higherIsBetter: false,
      },
    ],
    maintenance: [
      {
        title: "Module cleaning",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 30,
        estimatedMinutes: 240,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Wash the array. The interval is genuinely site-specific — dust load, bird load and the " +
          "monsoon move it in both directions — so 30 days is a starting point a site adjusts, " +
          "and soiling_loss_pct is the hand record that tells it which way.",
      },
      {
        title: "String I–V check and combiner box inspection",
        category: "predictive",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 180,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Trace each string's I–V curve and inspect the combiner box, fuses and diodes. This is " +
          "the field check the deferred string_current_deviation_pct would automate once " +
          "per-string metering exists: §5 declares one string_current_a key, and a deviation over " +
          "one value is not a deviation.",
      },
      {
        title: "Inverter service — filters, torque checks, DC insulation test",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 180,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Clean or change the cooling filters, re-torque the DC and AC terminations, and run the " +
          "DC insulation test. Confirm the result against insulation_resistance_kohm, which the " +
          "inverter reports from its own self-test.",
      },
      {
        title: "Thermography of DC and AC terminations",
        category: "predictive",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 120,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Thermal-scan the combiner boxes, the DC isolators and the AC terminations under load. " +
          "A loose termination is the failure that precedes a combiner fire, and no point in this " +
          "table sees it.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "inv_status", label: "Operating state", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "inv_fault", label: "Fault active", unit: null, required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "inv_event_code", label: "SunSpec event / vendor event bits", unit: null, required: false, sortOrder: 2, meta: EXTENDED },
    { ...MEASURED, pointKey: "dc_voltage_v", label: "DC input voltage", unit: "V", required: true, sortOrder: 3, meta: CORE },
    { ...MEASURED, pointKey: "dc_current_a", label: "DC input current", unit: "A", required: true, sortOrder: 4, meta: CORE },
    { ...MEASURED, pointKey: "dc_power_kw", label: "DC input power", unit: "kW", required: true, sortOrder: 5, meta: CORE },
    { ...MEASURED, pointKey: "ac_power_kw", label: "AC output active power", unit: "kW", required: true, sortOrder: 6, meta: CORE },
    { ...MEASURED, pointKey: "ac_kva", label: "AC apparent power", unit: "kVA", required: false, sortOrder: 7, meta: EXTENDED },
    { ...MEASURED, pointKey: "ac_pf", label: "Power factor", unit: null, required: false, sortOrder: 8, meta: EXTENDED },
    { ...MEASURED, pointKey: "ac_frequency_hz", label: "Grid frequency", unit: "Hz", required: true, sortOrder: 9, meta: CORE },
    { ...MEASURED, pointKey: "ac_voltage_vry", label: "AC line voltage R–Y", unit: "V", required: false, sortOrder: 10, meta: EXTENDED },
    { ...MEASURED, pointKey: "ac_voltage_vyb", label: "AC line voltage Y–B", unit: "V", required: false, sortOrder: 11, meta: EXTENDED },
    { ...MEASURED, pointKey: "ac_voltage_vbr", label: "AC line voltage B–R", unit: "V", required: false, sortOrder: 12, meta: EXTENDED },
    { ...MEASURED, pointKey: "ac_current_ir", label: "AC current R", unit: "A", required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "ac_current_iy", label: "AC current Y", unit: "A", required: false, sortOrder: 14, meta: EXTENDED },
    { ...MEASURED, pointKey: "ac_current_ib", label: "AC current B", unit: "A", required: false, sortOrder: 15, meta: EXTENDED },
    { ...MEASURED, pointKey: "energy_total_kwh", label: "Lifetime energy yield", unit: "kWh", required: true, sortOrder: 16, meta: CORE },
    // Tier C/D, authored MEASURED — energy-today needs a midnight boundary and
    // a running total, and the grammar has neither. The inverter reports it.
    { ...MEASURED, pointKey: "energy_today_kwh", label: "Energy today", unit: "kWh", required: true, sortOrder: 17, meta: CORE },
    { ...MEASURED, pointKey: "cabinet_temp_c", label: "Inverter cabinet / heatsink temperature", unit: "°C", required: false, sortOrder: 18, meta: EXTENDED },
    { ...MEASURED, pointKey: "irradiance_wm2", label: "Plane-of-array irradiance", unit: "W/m²", required: false, sortOrder: 19, meta: EXTENDED },
    { ...MEASURED, pointKey: "module_temp_c", label: "Module back-sheet temperature", unit: "°C", required: false, sortOrder: 20, meta: EXTENDED },
    { ...MEASURED, pointKey: "ambient_temp_c", label: "Ambient temperature", unit: "°C", required: false, sortOrder: 21, meta: EXTENDED },
    { ...MEASURED, pointKey: "string_current_a", label: "String current", unit: "A", required: false, sortOrder: 22, meta: EXTENDED },
    { ...MEASURED, pointKey: "insulation_resistance_kohm", label: "DC insulation resistance", unit: "kΩ", required: false, sortOrder: 23, meta: EXTENDED },
    // grid_export_kw (in-table D) is NOT declared — §5 says it is measured at
    // the point of connection, a §1 meter on ANOTHER asset. See the docblock.
    // The one M row — entered by hand (F1.8 / F1.9), never mapped from a data key.
    { ...MEASURED, pointKey: "soiling_loss_pct", label: "Soiling", unit: "%", required: false, sortOrder: 24, meta: MANUAL },
    // Derived, appended after the table rows. Default input age: the inverter
    // publishes DC and AC power on one SunSpec poll. Undefined at night, and
    // the engine skips the reading rather than reporting 0 % — see the docblock.
    {
      ...derived("{ac_power_kw} / {dc_power_kw} * 100"),
      pointKey: "inverter_efficiency_pct",
      label: "Inverter conversion efficiency",
      unit: "%",
      required: false,
      sortOrder: 25,
    },
  ],
};
