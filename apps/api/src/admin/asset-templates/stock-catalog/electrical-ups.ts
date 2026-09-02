import { CORE, derived, EXTENDED, MANUAL, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The electrical pack's static-UPS class — `F2.12` Task 6, ADR 0052
 * decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/electrical-derived-taglist-v1.md` §4 — *"UPS — static UPS
 * with battery (single or parallel)"*, whose rows are *"RFC 1628 groups, in the
 * repo's existing key names where they exist"*. All 29 of §4's table rows are
 * declared, **in the document's own order**, then the two derived codes —
 * **31 points: 12 core + 16 extended + 1 manual + 2 derived**, 12 alarms,
 * **no KPI**, 4 maintenance plans.
 *
 * **§4's TABLE INTERLEAVES THE TIERS, and the order here is the table's.**
 * `ups_alarm_code` (X) is row 3, ahead of `on_battery` (C); the six `X`
 * metering rows sit between C rows. Plan §5.3 lists them grouped
 * core-then-extended, which describes the tiers and not the order.
 *
 * **PROVISIONAL — derived from published practice, not client-confirmed**, and
 * the entry's own `description` says so (decision 6; there is no
 * `meta.provenance`). Plan §12 ruling 1 ships the maintenance plans on that
 * footing — **the tag list has no maintenance section** — so the derivation
 * basis is recorded here the way the tag list records its own at the top:
 *
 *  - **IEEE 1188 (VRLA) / IEEE 450 (VLA)** — the block-voltage and impedance
 *    survey and its interval. The standard also gives the acceptance criteria,
 *    and they stay per site: the plan carries the standard, not a milliohm.
 *  - **Autonomy-test practice** — an annual discharge test is the only way to
 *    know the real runtime, because `backup_min` is the UPS's own *estimate*
 *    from a model that ages with the battery. The test is what proves the
 *    estimate.
 *  - **Bypass-transfer practice** — an annual transfer to static bypass and
 *    back, which proves the path the `inverter_fault` alarm sends the load
 *    down.
 *
 * Both of those are `safetyCritical: true`, and they are the only two in the
 * whole row. The criterion is narrow and worth stating: **planned work that
 * removes the protection the asset exists to provide.** During the discharge
 * test the load is on battery for the duration; during the bypass transfer it
 * is unprotected. A DG service, a transformer oil sample or a PV string check
 * does not have that property, which is why none of them carries the flag.
 *
 * ---
 *
 * **EVERY ONE OF §4's 29 ROWS IS DECLARED.** No row carries the `text` unit
 * ADR 0051 Amendment 6 decision 7 ruled out, and no row reads another asset's
 * meter.
 *
 * **`health_pct` IS TIER `X/D` AND IS AUTHORED MEASURED** — the same ruling
 * `kwh_today` took on the feeder and `energy_today_kwh` takes on the PV class.
 * The vendor supplies a health figure where it exists, and **no `bms-calc-v1`
 * formula reconstructs one**: a real UPS health model reads impedance history,
 * age and discharge cycles, none of which this grammar can name. Authoring a
 * formula for it would be the placeholder ADR 0036 refuses.
 *
 * **`load_pct` IS A MEASURED CORE POINT HERE, and deferred on three other
 * classes.** RFC 1628's `upsOutputPercentLoad` reports it directly, so this
 * class needs no rating attribute — while the feeder, the transformer and the
 * DG set each defer the same code because kW ÷ rating needs one. That
 * asymmetry is why `DEFERRED_DERIVED_CODES` in `stock-catalog.spec.ts` is a
 * per-entry `Record` and not one flat list: a catalog-wide *"no entry declares
 * a deferred code"* check would fail on this correct entry.
 *
 * **THE DEFERRED DERIVED CODES**, each with the reason it is named rather than
 * placeholdered (ADR 0051 Amendment 6 decision 8: a code with no formula is not
 * vocabulary). §4 names five; one is authored below and four are deferred:
 *
 *  - `runtime_margin_min` = backup − required — the **site minimum** is a site
 *    value (it depends on the generator's start time), not a point.
 *  - `battery_events_per_month` — a time window the grammar has no state for.
 *  - `battery_age_months` — the commissioning date is an asset attribute.
 *  - `charge_cycle_count` — accumulation across events, which needs state.
 *
 * **THE TWO AUTHORED FORMULAS.**
 *
 *  - `load_headroom_pct` = `100 - {load_pct}`, `streaming`. §4 names it; it is
 *    expressible because §4 measures `load_pct` rather than deriving it.
 *  - `cell_voltage_spread_v` = `{cell_voltage_max_v} - {cell_voltage_min_v}`,
 *    `streaming`. **§4's prose `Derived:` list does not name a spread code.**
 *    This is the one point key in the whole row the tag list did not name, and
 *    it is here because the owner ruled it in at the plan gate (plan §12
 *    ruling 2) — asked rather than assumed, because a point key is seeded into
 *    `bms.point_keys`, foreign-keyed by `0058` and permanent, while a KPI code
 *    is per-entry content a version bump can change. The reason it was worth
 *    asking: §4's *"cell voltage spread high (weak block)"* alarm bullet had
 *    **no parameter to bind to**. An alarm whose parameter is not a point is
 *    an alarm nobody can rationalize, threshold or chart. It was planned as a
 *    `battery_cell_spread_v` KPI, and ruling 2 dropped that KPI as redundant
 *    once the point existed. **A v2 redline candidate for the tag list: add
 *    the spread to §4's derived list.**
 *
 * Both read points the UPS itself publishes on one poll, so both take the
 * default `maxInputAgeSeconds` (`null` → 300 s).
 *
 * **NO `content.kpis` KEY AT ALL** — not an empty array. The spread was the
 * only KPI planned for this class and ruling 2 turned it into a point; a KPI
 * restating a declared point is redundant. The key is absent rather than empty
 * because an empty array passes a `length === 0` check while still shipping a
 * promise of content, which is the deferral guard the feeder already carries
 * and `electrical-classes.spec.ts` asserts here with `Object.hasOwn`.
 *
 * **ALARMS — 12 philosophy rows, every one pair-absent** (ADR 0019 Amendment 2
 * decisions 1 and 2; B7: limit values are set per site at commissioning). §4
 * carries **nine** bullets and they become twelve rows: *"battery replace /
 * self-test failed"* splits into two and *"rectifier / inverter / fan fault"*
 * into three — six different failures with six different responses, each
 * binding a different declared point. 9 + 1 + 2 = 12. **Plan §5.3's header says
 * 11 and its own table lists these twelve codes**; its derivation sentence
 * counted the rectifier split and missed the battery one, so the header is an
 * arithmetic slip and the table is right. Collapsing the battery rows would
 * leave one of two declared points bound by nothing. Two bindings the spec
 * asserts: `overload` binds **`load_pct`** directly (the one class where that
 * is possible) and `cell_voltage_spread_high` binds **`cell_voltage_spread_v`**
 * (the reason that point exists).
 *
 * **THE ONE `M` ROW.** `impedance_test_result` reaches the platform through
 * `F1.8` manual entry / `F1.9` import, never through a data key. One
 * consequence, stated and not solved here: an `M` row carries
 * `sourceDataKeyPattern: null` forever, so `AssetTemplateInstantiationService`
 * lists it in `skippedPoints` and it **never gets an `asset_points` row** —
 * which means `F1.8` has nothing to attach a reading to yet. A flag for `F1.8`;
 * it is a manual-entry data-model question, not a catalog one.
 *
 * **UNITS.** Authored from `packages/db/src/point-keys-seed.ts`'s `UNIT_BY_KEY`
 * and not from §4's Unit column, because those spellings are permanent and
 * `onboarding-commit.service.ts` refuses a client CSV that disagrees. `unit` is
 * `null` wherever `UNIT_BY_KEY` holds `""` — the seven `0/1` flags,
 * `ups_status`'s and `battery_last_test`'s "enum", `ups_alarm_code`'s "code"
 * and `impedance_test_result`'s "enum". A template `unit` is an *override*;
 * `null` defers to the catalog's own unit. Labels drop the table's editorial
 * remarks (`(existing key)`, `(BMS)`, `(manual or BMS)`, `(vendor / RFC enum)`,
 * `` (`upsAlarmsPresent` > 0) ``).
 *
 * ---
 *
 * **VERSION HISTORY** (ADR 0052 decision 6): a change to a shipped entry is a
 * new `stockVersion`, recorded here, taken by an organization through a
 * re-import (decision 4), never by mutating its row.
 *
 *  - `electrical-ups` **v1** (2026-09-02, `F2.12`): authored from
 *    `electrical-derived-taglist-v1.md` §4, PROVISIONAL — derived, not
 *    client-confirmed, and carrying one point key (`cell_voltage_spread_v`)
 *    the document does not name, by owner ruling. The client-confirmed release
 *    is v2; its redline candidate is recorded above.
 */
export const ELECTRICAL_UPS: StockAssetTemplateEntry = {
  code: "electrical-ups",
  name: "UPS — static UPS with battery",
  assetType: "ups",
  domain: "electrical",
  description:
    "Static (double-conversion) UPS with a battery string, single or parallel, in RFC 1628's " +
    "register groups. Authored from docs/electrical-derived-taglist-v1.md §4 (PROVISIONAL — " +
    "derived from industry practice, not client-confirmed). This class reports its own output " +
    "load directly, so unlike a feeder, a transformer or a DG set its overload row binds a " +
    "measured percentage. Tier C points are required, X optional, M entered by hand; alarm rows " +
    "carry a meaning and no limit.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "on_battery",
        pointKey: "on_battery",
        severity: "warning",
        category: "operations",
        message: "Input lost — the load is on battery and the clock is running.",
      },
      {
        code: "low_runtime",
        pointKey: "backup_min",
        severity: "critical",
        category: "operations",
        message:
          "Estimated runtime below the site minimum. The minimum is per site — it depends on how " +
          "long the generator takes to start and take load — so no number is carried here.",
      },
      {
        code: "on_bypass",
        pointKey: "on_bypass",
        severity: "warning",
        category: "operations",
        message: "On static bypass — the load is unprotected.",
      },
      {
        code: "overload",
        pointKey: "load_pct",
        severity: "critical",
        category: "operations",
        message:
          "Output load above the unit's rating. Binds load_pct directly, which the UPS reports as " +
          "a measured value; this class needs no rating attribute.",
      },
      {
        code: "battery_temp_high",
        pointKey: "battery_temp_c",
        severity: "critical",
        category: "safety",
        message:
          "Battery temperature high — VRLA life halves per 10 °C, and this is the lead indicator " +
          "for thermal runaway.",
      },
      {
        code: "battery_replace",
        pointKey: "battery_replace_flag",
        severity: "warning",
        category: "operations",
        message: "Self-test says the battery needs replacement — order it before the next outage.",
      },
      {
        code: "battery_self_test_failed",
        pointKey: "battery_last_test",
        severity: "warning",
        category: "operations",
        message:
          "The last battery self-test did not pass. A different response from battery_replace: " +
          "the test itself is the thing to investigate first.",
      },
      {
        code: "rectifier_fault",
        pointKey: "rectifier_ok",
        severity: "critical",
        category: "operations",
        message: "Rectifier / charger unhealthy — the battery is not being recharged.",
      },
      {
        code: "inverter_fault",
        pointKey: "inverter_ok",
        severity: "critical",
        category: "operations",
        message: "Inverter unhealthy — the next transfer is to bypass, unprotected.",
      },
      {
        code: "fan_fault",
        pointKey: "fan_ok",
        severity: "warning",
        category: "operations",
        message: "Cooling fan failed — derating and heat ageing follow.",
      },
      {
        code: "input_voltage_out_of_range",
        pointKey: "input_voltage_v",
        severity: "warning",
        category: "operations",
        message:
          "Input outside the window the UPS will accept without going to battery. The window is " +
          "the unit's own and is set per site at commissioning.",
      },
      {
        code: "cell_voltage_spread_high",
        pointKey: "cell_voltage_spread_v",
        severity: "warning",
        category: "operations",
        message:
          "The spread between the lowest and the highest block is widening — a weak block. The " +
          "limit is set per site at commissioning. Binds the derived cell_voltage_spread_v, which " +
          "exists so this row has a parameter of its own.",
      },
    ],
    // NO `kpis` key — not an empty array. Plan §12 ruling 2 turned the planned
    // battery_cell_spread_v KPI into a point, and a KPI restating a declared
    // point is redundant. See the module docblock.
    maintenance: [
      {
        title: "Battery block voltage and impedance survey",
        category: "predictive",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 180,
        priority: "high",
        safetyCritical: false,
        complianceRef: "IEEE 1188 (VRLA) / IEEE 450 (VLA)",
        triggerSummary:
          "Measure every block's voltage and impedance or conductance. The result is entered by " +
          "hand on impedance_test_result, and the cell_voltage_min_v / cell_voltage_max_v spread " +
          "is the online version of the same reading. The standard's acceptance criteria are per " +
          "site, so the plan carries the standard and not a milliohm.",
      },
      {
        title: "Battery autonomy (discharge) test",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 240,
        priority: "high",
        safetyCritical: true,
        triggerSummary:
          "The load is on battery for the duration of the test — planned work that removes the " +
          "protection the asset exists to provide, which is what safetyCritical means here. " +
          "Confirm the measured runtime against backup_min's estimate: that estimate comes from a " +
          "model that ages with the battery, and this test is the only thing that proves it.",
      },
      {
        title: "Fan and air filter service",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 60,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Clean or change the air filters and prove each cooling fan runs — the failure fan_fault " +
          "alarms on, and the one that derates the unit before it trips it.",
      },
      {
        title: "Bypass transfer test",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 90,
        priority: "high",
        safetyCritical: true,
        triggerSummary:
          "Transfer the load to static bypass and back. The load is unprotected during the test, " +
          "which is why it is safetyCritical — and the test proves the path the inverter_fault " +
          "alarm sends the load down.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "ups_status", label: "Output source: normal / on battery / bypass / off", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "ups_alarm", label: "Any alarm present", unit: null, required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "ups_alarm_code", label: "Highest active alarm", unit: null, required: false, sortOrder: 2, meta: EXTENDED },
    { ...MEASURED, pointKey: "on_battery", label: "Output on battery", unit: null, required: true, sortOrder: 3, meta: CORE },
    { ...MEASURED, pointKey: "on_bypass", label: "Output on bypass", unit: null, required: true, sortOrder: 4, meta: CORE },
    { ...MEASURED, pointKey: "input_voltage_v", label: "Input voltage, worst phase", unit: "V", required: true, sortOrder: 5, meta: CORE },
    { ...MEASURED, pointKey: "input_frequency_hz", label: "Input frequency", unit: "Hz", required: false, sortOrder: 6, meta: EXTENDED },
    { ...MEASURED, pointKey: "output_voltage_v", label: "Output voltage", unit: "V", required: true, sortOrder: 7, meta: CORE },
    { ...MEASURED, pointKey: "output_freq_hz", label: "Output frequency", unit: "Hz", required: true, sortOrder: 8, meta: CORE },
    { ...MEASURED, pointKey: "output_current_a", label: "Output current (total)", unit: "A", required: false, sortOrder: 9, meta: EXTENDED },
    { ...MEASURED, pointKey: "output_kw", label: "Output active power", unit: "kW", required: false, sortOrder: 10, meta: EXTENDED },
    { ...MEASURED, pointKey: "output_kva", label: "Output apparent power", unit: "kVA", required: false, sortOrder: 11, meta: EXTENDED },
    // Measured and CORE here, deferred on the feeder, the transformer and the
    // DG set — RFC 1628 reports it directly. See the module docblock.
    { ...MEASURED, pointKey: "load_pct", label: "Output load", unit: "%", required: true, sortOrder: 12, meta: CORE },
    { ...MEASURED, pointKey: "battery_v", label: "Battery bus voltage", unit: "V", required: true, sortOrder: 13, meta: CORE },
    { ...MEASURED, pointKey: "battery_current_a", label: "Battery current (+ charge / − discharge)", unit: "A", required: false, sortOrder: 14, meta: EXTENDED },
    { ...MEASURED, pointKey: "battery_temp_c", label: "Battery temperature", unit: "°C", required: true, sortOrder: 15, meta: CORE },
    { ...MEASURED, pointKey: "battery_charge_pct", label: "Battery charge remaining", unit: "%", required: true, sortOrder: 16, meta: CORE },
    { ...MEASURED, pointKey: "backup_min", label: "Estimated minutes remaining", unit: "min", required: true, sortOrder: 17, meta: CORE },
    { ...MEASURED, pointKey: "battery_time_on_s", label: "Seconds on battery this event", unit: "s", required: false, sortOrder: 18, meta: EXTENDED },
    { ...MEASURED, pointKey: "battery_replace_flag", label: "Battery needs replacement (self-test)", unit: null, required: false, sortOrder: 19, meta: EXTENDED },
    { ...MEASURED, pointKey: "battery_last_test", label: "Last self-test result", unit: null, required: false, sortOrder: 20, meta: EXTENDED },
    // Tier X/D, authored MEASURED — the vendor supplies it and no bms-calc-v1
    // formula reconstructs it (the ruling kwh_today took on the feeder).
    { ...MEASURED, pointKey: "health_pct", label: "Vendor or derived health", unit: "%", required: false, sortOrder: 21, meta: EXTENDED },
    { ...MEASURED, pointKey: "rectifier_ok", label: "Rectifier / charger healthy", unit: null, required: false, sortOrder: 22, meta: EXTENDED },
    { ...MEASURED, pointKey: "inverter_ok", label: "Inverter healthy", unit: null, required: false, sortOrder: 23, meta: EXTENDED },
    { ...MEASURED, pointKey: "fan_ok", label: "Cooling fan healthy", unit: null, required: false, sortOrder: 24, meta: EXTENDED },
    { ...MEASURED, pointKey: "ambient_temp_c", label: "UPS room / rack ambient", unit: "°C", required: false, sortOrder: 25, meta: EXTENDED },
    { ...MEASURED, pointKey: "cell_voltage_min_v", label: "Lowest cell / block voltage", unit: "V", required: false, sortOrder: 26, meta: EXTENDED },
    { ...MEASURED, pointKey: "cell_voltage_max_v", label: "Highest cell / block voltage", unit: "V", required: false, sortOrder: 27, meta: EXTENDED },
    // The one M row — entered by hand (F1.8 / F1.9), never mapped from a data key.
    { ...MEASURED, pointKey: "impedance_test_result", label: "Battery impedance / conductance", unit: null, required: false, sortOrder: 28, meta: MANUAL },
    // Derived, appended after the table rows. Both take the default input age:
    // the UPS publishes every input below on one poll.
    {
      ...derived("100 - {load_pct}"),
      pointKey: "load_headroom_pct",
      label: "Output load headroom",
      unit: "%",
      required: false,
      sortOrder: 29,
    },
    // Owner-ruled in at the plan gate (plan §12 ruling 2). §4 names no spread
    // code; it exists so cell_voltage_spread_high binds a parameter of its own.
    {
      ...derived("{cell_voltage_max_v} - {cell_voltage_min_v}"),
      pointKey: "cell_voltage_spread_v",
      label: "Battery block voltage spread",
      unit: "V",
      required: false,
      sortOrder: 30,
    },
  ],
};
