import { CORE, derived, EXTENDED, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The electrical pack's diesel-generator class — `F2.12` Task 5, ADR 0052
 * decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/electrical-derived-taglist-v1.md` §3 — *"DG set — diesel
 * generator with AMF/controller"*, whose points *"mirror the DSE / ComAp /
 * PowerCommand register groups; every DG controller in the Indian market
 * exposes this set"*. All 36 of §3's table rows are declared, **in the
 * document's own order**, then the two derived codes — **38 points: 21 core +
 * 15 extended + 0 manual + 2 derived**, 13 alarms, 1 KPI, 5 maintenance plans.
 *
 * **§3's TABLE INTERLEAVES THE TIERS, and the order here is the table's.**
 * `dg_alarm_code` (X) is row 6, ahead of `mains_available` (C); `oil_temp_c`
 * and `exhaust_temp_c` (X) sit between two C rows. Plan §5.2 lists the rows
 * grouped core-then-extended, which is a description of the tiers and not of
 * the order; reading it as an order would move eleven rows, and every one of
 * them would still pass a count check. `electrical-classes.spec.ts` asserts the
 * document's order literally for that reason.
 *
 * **PROVISIONAL — derived from published practice, not client-confirmed**, and
 * the entry's own `description` says so, because the stamp plus the citation is
 * the provenance (decision 6) and there is no `meta.provenance`. The tag list
 * marks itself the same way. Plan §12 ruling 1 ships the maintenance plans and
 * the KPI code on that footing: **the tag list has no maintenance section and
 * names no KPI code**, so the derivation basis is recorded here the way the tag
 * list records its own at the top —
 *
 *  - **OEM service intervals** — every major set (Cummins, Kirloskar, Caterpillar,
 *    Ashok Leyland) publishes an engine service at **250 running hours or six
 *    months, whichever comes first**. That is the one plan in this entry with
 *    `generationMode: "runtime"`; `run_hours_h` is the counter it is scheduled
 *    on and `service_due_h` is the controller's own countdown of the same thing.
 *  - **Load-bank practice** — a standby set that only ever runs its weekly
 *    no-load test wet-stacks. An annual load-bank run at ≥ 70 % of rating for an
 *    hour is the control, and it is what the tag list's deferred
 *    `underload_hours` derived code was for.
 *  - **Standby-availability practice** — the weekly test run, the monthly
 *    starter-battery check and the quarterly fuel-system drain exist because a
 *    standby set fails at the moment it is asked to start, so every one of them
 *    is a check of the *next* start rather than of the current run.
 *
 * The asymmetry that makes authoring this safe: **a KPI code is per-entry
 * template content, changeable by a version bump; a point key is seeded into
 * `bms.point_keys`, foreign-keyed by `0058` and permanent.** This entry invents
 * no point key. `specific_fuel_l_kwh` and `unplanned_run_flag` are not invented
 * — §3's `Derived:` line names both, and ADR 0051 Amendment 6 decision 8
 * pre-authorized promoting each code a formula can be written for.
 *
 * ---
 *
 * **EVERY ONE OF §3's 36 ROWS IS DECLARED.** Unlike §2, this section excludes
 * nothing: no row carries the `text` unit ADR 0051 Amendment 6 decision 7 ruled
 * out, no row is an in-table `D`, and no row reads another asset's meter. §3
 * also has **no `M` column entries at all** — a DG controller instruments every
 * row it names, so this entry has no `meta.tier: "manual"` and no `F1.8`
 * exposure, which is what makes it the cheapest of the five to import.
 *
 * **AND UNLIKE §2, THIS CLASS CAN EXPRESS ITS OWN LOADING.** §3 embeds its own
 * generator metering rows (`gen_voltage_*`, `gen_current_*`, `gen_frequency_hz`,
 * `gen_kw`, `gen_kva`, `gen_pf`, `gen_kwh_total`), so a DG asset needs no
 * companion feeder/incomer template to see its own output — the transformer
 * does, and its module docblock records why. That is why the `overload` alarm
 * below survives here and is deferred there.
 *
 * **THE DEFERRED DERIVED CODES**, each with the reason it is named rather than
 * placeholdered (ADR 0051 Amendment 6 decision 8: a code with no formula is not
 * vocabulary). §3 names seven; two are authored below and five are deferred:
 *
 *  - `load_pct` = kW ÷ rating — the rating is an asset attribute, and
 *    `bms-calc-v1` has no way to read one. Deferred on the feeder and the
 *    transformer for the same reason; **a measured core point on the UPS**,
 *    which reports it directly, which is why the deferral ledger is per entry.
 *  - `fuel_hours_remaining_h` — the tag list writes it *"level ÷ rate"*, but
 *    `fuel_level_pct` is a **percentage**. Turning it into litres needs the day
 *    tank's capacity, an asset attribute.
 *  - `starts_per_day` — a time window the grammar has no state for.
 *  - `availability_pct` — the same, over a longer window.
 *  - `underload_hours` — hours-in-state, which is a time window *and* a
 *    threshold. The annual load-bank plan below is the practice that covers it.
 *
 * **THE TWO AUTHORED FORMULAS, and the reasoning each one must carry.**
 *
 *  - `specific_fuel_l_kwh` = `{fuel_rate_lph} / {gen_kw}`, `streaming`, default
 *    input age. **It is undefined at zero output** — the set running unloaded on
 *    its weekly test — and that is handled, not guarded: `evaluate.ts` returns
 *    `non_finite` for any node whose result fails `Number.isFinite`, so the
 *    engine produces **no value for that reading** and the skip is visible in
 *    its own count. **Do not add a `clamp` or a `max(…, 0.001)`**: a fabricated
 *    denominator turns "no data" into a plausible litres-per-kWh figure, which
 *    is worse than a gap on a fuel-cost chart.
 *  - `unplanned_run_flag` = `{dg_status} * {mains_available}`, `streaming`.
 *    **This is a boolean AND written as a product of two 0/1 codes**, which is
 *    the only way this grammar has of writing one — there is no `and`, no
 *    comparison operator and no boolean type. It therefore **depends on the
 *    ingest normaliser mapping both codes to exactly 0 or 1**, which ADR 0051
 *    Amendment 6 decision 7 already commits to for every enum- and code-valued
 *    row. A site that publishes `dg_status` as 0/2 gets 0/2 out of this point.
 *
 * Both read points the AMF controller publishes on one scan, so both take the
 * default `maxInputAgeSeconds` (`null` → 300 s). The transformer's
 * `oil_rise_over_ambient_c` is the one point in the row that overrides it.
 *
 * **THE ONE KPI, and the qualification it must carry.**
 * `failed_start_ratio_pct` = `{failed_start_count} / {start_count} * 100`.
 * **Both inputs are cumulative lifetime counters**, so this is a **lifetime
 * ratio and not a rate** — it moves slower and slower as a healthy set
 * accumulates starts, and a set commissioned last week is not comparable with
 * one commissioned in 2019. That is exactly why it is a KPI an operator reads
 * as a trend and **never an alarm**: asserting on a lifetime counter is the
 * anti-pattern the rulebook names, and `electrical-classes.spec.ts` asserts
 * that no alarm here binds `start_count`. The `fail_to_start` alarm binds
 * `failed_start_count`, whose *rise* is the event worth waking someone for.
 *
 * **ALARMS — 13 philosophy rows, every one pair-absent** (ADR 0019 Amendment 2
 * decisions 1 and 2; B7: limit values are set per site at commissioning). §3 is
 * the one section whose bullets map **1:1** onto rows — nothing splits, nothing
 * is deferred. No `thresholdValue`, no `operator`; the meaning is carried by
 * `message`. Two bindings the plan reasoned about and the spec asserts:
 * `overload` binds **`gen_kw`** and not `load_pct` (the 2026-09-02 ruling the
 * feeder took, for the same reason — the rating is an attribute), and
 * `unplanned_run` binds **`unplanned_run_flag`**. That second binding is *why*
 * `unplanned_run_flag` is a point rather than a KPI: an alarm binds a
 * `pointKey`, so without the derived point §3's *"DG running with mains
 * available (cost)"* bullet has no parameter to bind to at all.
 *
 * **UNITS.** Authored from `packages/db/src/point-keys-seed.ts`'s `UNIT_BY_KEY`
 * and not from §3's Unit column, because those spellings are the permanent ones
 * and `onboarding-commit.service.ts` refuses a client CSV that disagrees with
 * them. `engine_speed_rpm` is therefore **`RPM`** and not §3's `rpm`. `unit` is
 * `null` wherever `UNIT_BY_KEY` holds `""` — the eleven `0/1` flags and
 * contacts, `dg_mode`'s "enum", `dg_alarm_code`'s "code", the two "count" rows
 * and `gen_pf`'s dimensionless "—". A template `unit` is an *override*; `null`
 * defers to the catalog's own unit. Labels drop the table's editorial remarks
 * (`(existing key)`, `(ECU or flow meter)`, `(vendor enum)`, `(controller)`).
 *
 * ---
 *
 * **VERSION HISTORY** (ADR 0052 decision 6): a change to a shipped entry is a
 * new `stockVersion`, recorded here, taken by an organization through a
 * re-import (decision 4), never by mutating its row.
 *
 *  - `electrical-dg-set` **v1** (2026-09-02, `F2.12`): authored from
 *    `electrical-derived-taglist-v1.md` §3, PROVISIONAL — derived, not
 *    client-confirmed. The client-confirmed release is v2.
 */
export const ELECTRICAL_DG_SET: StockAssetTemplateEntry = {
  code: "electrical-dg-set",
  name: "DG set — diesel generator with AMF controller",
  assetType: "dg_set",
  domain: "electrical",
  description:
    "Diesel generator set with an AMF / auto-start controller (DSE, ComAp, PowerCommand or " +
    "equivalent register groups). Authored from docs/electrical-derived-taglist-v1.md §3 " +
    "(PROVISIONAL — derived from industry practice, not client-confirmed). Unlike the transformer " +
    "this class carries its own generator metering rows (gen_*), so a DG asset sees its own " +
    "output without a companion feeder/incomer template. Tier C points are required and X " +
    "optional; §3 has no manual rows. Alarm rows carry a meaning and no limit.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "shutdown",
        pointKey: "dg_shutdown",
        severity: "critical",
        category: "safety",
        message:
          "Controller shutdown — the set has tripped and standby cover is lost. The reason code " +
          "is in dg_alarm_code.",
      },
      {
        code: "fail_to_start",
        pointKey: "failed_start_count",
        severity: "critical",
        category: "operations",
        message:
          "The set failed to start on demand — standby cover is lost until it is investigated. " +
          "The rise in the counter is the event; the lifetime ratio is the failed_start_ratio_pct " +
          "KPI and is deliberately not an alarm.",
      },
      {
        code: "oil_pressure_low",
        pointKey: "oil_pressure_bar",
        severity: "critical",
        category: "safety",
        message: "Lube oil pressure below the engine's protection setting.",
      },
      {
        code: "coolant_temp_high",
        pointKey: "coolant_temp_c",
        severity: "critical",
        category: "safety",
        message: "Coolant temperature above the engine's protection setting.",
      },
      {
        code: "overspeed",
        pointKey: "engine_speed_rpm",
        severity: "critical",
        category: "safety",
        message: "Engine over its speed limit — a governor or load-rejection fault.",
      },
      {
        code: "fuel_level_low",
        pointKey: "fuel_level_pct",
        severity: "warning",
        category: "operations",
        message:
          "Day-tank level low — the set's remaining runtime is at risk. The hours it converts to " +
          "need the tank capacity, an asset attribute, so no runtime figure is carried here.",
      },
      {
        code: "battery_voltage_low",
        pointKey: "battery_v",
        severity: "warning",
        category: "operations",
        message: "Starter battery below its float band — the next start is at risk.",
      },
      {
        code: "charger_fault",
        pointKey: "charger_alternator_v",
        severity: "warning",
        category: "operations",
        message: "Charge alternator not charging while the engine runs.",
      },
      {
        code: "overload",
        pointKey: "gen_kw",
        severity: "warning",
        category: "operations",
        message:
          "Output above the set's continuous rating. The rating is per site and per set, so this " +
          "row binds gen_kw and carries no number.",
      },
      {
        code: "frequency_out_of_band",
        pointKey: "gen_frequency_hz",
        severity: "warning",
        category: "operations",
        message:
          "Generator frequency outside the quality band — a governor or loading problem. The band " +
          "is set per site at commissioning, in both directions.",
      },
      {
        code: "unplanned_run",
        pointKey: "unplanned_run_flag",
        severity: "warning",
        category: "energy",
        message:
          "The set is running while mains is healthy — diesel burnt for no reason. Binds the " +
          "derived unplanned_run_flag, which is why that code is a point and not a KPI.",
      },
      {
        code: "service_due",
        pointKey: "service_due_h",
        severity: "info",
        category: "operations",
        message: "The controller's service countdown has expired.",
      },
      {
        code: "emergency_stop",
        pointKey: "emergency_stop_state",
        severity: "critical",
        category: "safety",
        message: "Emergency stop operated.",
      },
    ],
    kpis: [
      {
        // A LIFETIME ratio over two cumulative counters, not a rate — which is
        // exactly why it is a KPI and never an alarm. See the module docblock.
        code: "failed_start_ratio_pct",
        name: "Failed start ratio",
        unit: "%",
        pointKeys: ["failed_start_count", "start_count"],
        expression: "{failed_start_count} / {start_count} * 100",
        dialect: "bms-calc-v1",
        higherIsBetter: false,
      },
    ],
    maintenance: [
      {
        title: "Weekly no-load test run",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 7,
        estimatedMinutes: 30,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Start the set on test, run it for fifteen minutes, and confirm that oil_pressure_bar, " +
          "coolant_temp_c and gen_frequency_hz settle. A standby set fails at the moment it is " +
          "asked to start, so this is a check of the next start and not of the current run.",
      },
      {
        title: "Engine service — oil, oil filter, fuel filter, air filter",
        category: "runtime_based",
        generationMode: "runtime",
        intervalDays: 182,
        estimatedMinutes: 240,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Every 250 engine run hours (run_hours_h) or six months, whichever comes first — the " +
          "OEM interval every major set publishes. service_due_h carries the controller's own " +
          "countdown of the same thing. intervalDays is the calendar backstop " +
          "templateMaintenancePlanSchema requires: a runtime plan still needs one.",
      },
      {
        title: "Starter battery check — electrolyte, terminals, float voltage",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 30,
        estimatedMinutes: 20,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Read battery_v on float and charger_alternator_v with the engine running — the two " +
          "points the battery_voltage_low and charger_fault alarms bind to. A flat starter " +
          "battery is the most common reason a healthy set does not start.",
      },
      {
        title: "Fuel system — day tank and bulk tank water drain, strainer",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 91,
        estimatedMinutes: 60,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Drain water from the day tank and the bulk tank and clean the strainer. Water in the " +
          "day tank is the most common cause of a fail-to-start after a flat battery.",
      },
      {
        title: "Annual load-bank test",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 300,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Load the set to at least 70 % of its rating for one hour. This is the wet-stacking " +
          "control the tag list's deferred underload_hours derived code was for, and the one run " +
          "where specific_fuel_l_kwh reads a meaningful figure.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "dg_status", label: "Engine running", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "dg_mode", label: "Auto / manual / off / test", unit: null, required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "dg_on_load", label: "Generator breaker closed", unit: null, required: true, sortOrder: 2, meta: CORE },
    { ...MEASURED, pointKey: "dg_alarm", label: "Warning active", unit: null, required: true, sortOrder: 3, meta: CORE },
    { ...MEASURED, pointKey: "dg_shutdown", label: "Shutdown / trip active", unit: null, required: true, sortOrder: 4, meta: CORE },
    { ...MEASURED, pointKey: "dg_alarm_code", label: "Active alarm / shutdown code", unit: null, required: false, sortOrder: 5, meta: EXTENDED },
    { ...MEASURED, pointKey: "mains_available", label: "Mains healthy — AMF sense", unit: null, required: true, sortOrder: 6, meta: CORE },
    { ...MEASURED, pointKey: "engine_speed_rpm", label: "Engine speed", unit: "RPM", required: true, sortOrder: 7, meta: CORE },
    { ...MEASURED, pointKey: "oil_pressure_bar", label: "Lube oil pressure", unit: "bar", required: true, sortOrder: 8, meta: CORE },
    { ...MEASURED, pointKey: "coolant_temp_c", label: "Coolant temperature", unit: "°C", required: true, sortOrder: 9, meta: CORE },
    { ...MEASURED, pointKey: "oil_temp_c", label: "Lube oil temperature", unit: "°C", required: false, sortOrder: 10, meta: EXTENDED },
    { ...MEASURED, pointKey: "exhaust_temp_c", label: "Exhaust gas temperature", unit: "°C", required: false, sortOrder: 11, meta: EXTENDED },
    { ...MEASURED, pointKey: "fuel_level_pct", label: "Day-tank fuel level", unit: "%", required: true, sortOrder: 12, meta: CORE },
    { ...MEASURED, pointKey: "bulk_fuel_level_pct", label: "Bulk tank fuel level", unit: "%", required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "fuel_rate_lph", label: "Fuel consumption rate", unit: "L/hr", required: false, sortOrder: 14, meta: EXTENDED },
    { ...MEASURED, pointKey: "fuel_totalizer_l", label: "Fuel consumed, cumulative", unit: "L", required: false, sortOrder: 15, meta: EXTENDED },
    { ...MEASURED, pointKey: "battery_v", label: "Starter battery voltage", unit: "V", required: true, sortOrder: 16, meta: CORE },
    { ...MEASURED, pointKey: "charger_alternator_v", label: "Charge alternator voltage", unit: "V", required: false, sortOrder: 17, meta: EXTENDED },
    { ...MEASURED, pointKey: "coolant_level_low", label: "Coolant level low switch", unit: null, required: false, sortOrder: 18, meta: EXTENDED },
    { ...MEASURED, pointKey: "run_hours_h", label: "Engine run hours", unit: "h", required: true, sortOrder: 19, meta: CORE },
    { ...MEASURED, pointKey: "start_count", label: "Engine starts, cumulative", unit: null, required: false, sortOrder: 20, meta: EXTENDED },
    { ...MEASURED, pointKey: "failed_start_count", label: "Failed starts", unit: null, required: false, sortOrder: 21, meta: EXTENDED },
    { ...MEASURED, pointKey: "gen_voltage_vry", label: "Generator line voltage R–Y", unit: "V", required: true, sortOrder: 22, meta: CORE },
    { ...MEASURED, pointKey: "gen_voltage_vyb", label: "Generator line voltage Y–B", unit: "V", required: true, sortOrder: 23, meta: CORE },
    { ...MEASURED, pointKey: "gen_voltage_vbr", label: "Generator line voltage B–R", unit: "V", required: true, sortOrder: 24, meta: CORE },
    { ...MEASURED, pointKey: "gen_current_ir", label: "Generator current R", unit: "A", required: true, sortOrder: 25, meta: CORE },
    { ...MEASURED, pointKey: "gen_current_iy", label: "Generator current Y", unit: "A", required: true, sortOrder: 26, meta: CORE },
    { ...MEASURED, pointKey: "gen_current_ib", label: "Generator current B", unit: "A", required: true, sortOrder: 27, meta: CORE },
    { ...MEASURED, pointKey: "gen_frequency_hz", label: "Generator frequency", unit: "Hz", required: true, sortOrder: 28, meta: CORE },
    { ...MEASURED, pointKey: "gen_kw", label: "Generator active power", unit: "kW", required: true, sortOrder: 29, meta: CORE },
    { ...MEASURED, pointKey: "gen_kva", label: "Generator apparent power", unit: "kVA", required: false, sortOrder: 30, meta: EXTENDED },
    { ...MEASURED, pointKey: "gen_pf", label: "Generator power factor", unit: null, required: false, sortOrder: 31, meta: EXTENDED },
    { ...MEASURED, pointKey: "gen_kwh_total", label: "Generator energy, cumulative", unit: "kWh", required: true, sortOrder: 32, meta: CORE },
    { ...MEASURED, pointKey: "service_due_h", label: "Hours to next service", unit: "h", required: false, sortOrder: 33, meta: EXTENDED },
    { ...MEASURED, pointKey: "emergency_stop_state", label: "E-stop pressed", unit: null, required: false, sortOrder: 34, meta: EXTENDED },
    { ...MEASURED, pointKey: "canopy_temp_c", label: "Acoustic canopy / room temperature", unit: "°C", required: false, sortOrder: 35, meta: EXTENDED },
    // Derived, appended after the table rows, in §3's own "Derived:" order.
    // Both take the default input age: an AMF controller publishes every input
    // below on one scan. Undefined at zero output is handled by the engine
    // (non_finite, the reading is skipped) and never by a fabricated
    // denominator — see the module docblock.
    {
      ...derived("{fuel_rate_lph} / {gen_kw}"),
      pointKey: "specific_fuel_l_kwh",
      label: "Specific fuel consumption",
      unit: "L/kWh",
      required: false,
      sortOrder: 36,
    },
    {
      ...derived("{dg_status} * {mains_available}"),
      pointKey: "unplanned_run_flag",
      label: "Running with mains available",
      unit: null,
      required: false,
      sortOrder: 37,
    },
  ],
};
