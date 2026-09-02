import { CORE, derived, EXTENDED, MANUAL, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The electrical pack's transformer class — `F2.12` Task 4, ADR 0052
 * decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/electrical-derived-taglist-v1.md` §2 — *"Transformer —
 * oil-immersed distribution / power transformer (dry-type: drop oil rows, keep
 * winding RTDs)"*, the SOW page-9 asset with the most on-screen detail
 * (*2.60 MVA, 11.2/0.433 kV, 48.7 °C, Load 72%*). §2's 31 table rows less the
 * two below, in the table's own order (`sortOrder` 0…28), then the one derived
 * code — **30 points: 9 core + 16 extended + 4 manual + 1 derived**, 15 alarms,
 * 2 KPIs, 5 maintenance plans.
 *
 * **PROVISIONAL — derived from published practice, not client-confirmed**, and
 * the entry's own `description` says so, because the stamp plus the citation is
 * the provenance (decision 6) and there is no `meta.provenance`. The tag list
 * marks itself the same way. Plan §12 ruling 1 ships the maintenance plans and
 * the two KPI codes on that footing: **the tag list has no maintenance section
 * and names neither KPI code**, so their derivation basis is recorded here the
 * way the tag list records its own at the top —
 *
 *  - **IEEE C57.106 / IS 1866** — the oil-sample interval and the acceptance
 *    values behind the annual BDV / moisture / DGA plan and the `oil_bdv_low`
 *    alarm. The numbers stay per site: the plan carries the standard, not a kV.
 *  - **Protection-test practice** — a six-monthly function test of the
 *    Buchholz, PRV, OTI and WTI contacts. It is the only `safetyCritical` plan
 *    in this entry, and it is the task the eight protection alarms below
 *    depend on: an alarm bound to a contact nobody has proved is a philosophy
 *    row with no instrument behind it.
 *  - **Megger practice** — an annual insulation-resistance test, which needs an
 *    outage, and whose result is a hand-entered `M` row.
 *  - **IEC 60076-7 / IEEE C57.91** are the tag list's own basis for the
 *    thermal rows; they are named here because the two loading models they
 *    describe are exactly what this entry defers (below).
 *
 * The asymmetry that makes authoring this safe: **a KPI code is per-entry
 * template content, changeable by a version bump; a point key is seeded into
 * `bms.point_keys`, foreign-keyed by `0058` and permanent.** This entry invents
 * no point key. `oil_rise_over_ambient_c` is not invented — the tag list names
 * it, and ADR 0051 Amendment 6 decision 8 pre-authorized promoting it.
 *
 * ---
 *
 * **TWO OF §2's 31 ROWS ARE DELIBERATELY NOT DECLARED.**
 *
 *  - **`dga_lab_result`** (tier `M`, unit `text`) — ADR 0051 Amendment 6
 *    decision 7 excluded it from the vocabulary: `telemetry.point_values.value`
 *    is a finite double, and there is nothing for a lab summary string to be
 *    stored as. It is in no `*_POINT_KEYS` array, so declaring it would fail
 *    `assertPointKeysActive` at import and `0058`'s foreign key at insert — on
 *    a customer's site, not at build time. It stays a lab record for `F1.13` or
 *    a maintenance note.
 *  - **`lv_load_pct`** (in-table `D`) — the LV-side load is measured by a §1
 *    meter on **another asset**, the transformer's LV feeder, and
 *    `bms-calc-v1` cannot name a cross-asset value.
 *
 * **THE FINDING A READER MUST NOT HAVE TO DERIVE: this class cannot express
 * its own headline number.** §2's table carries **no current, kVA or kW row at
 * all**. So this entry can express neither page-9's *Load 72%* nor an
 * `overload` alarm, and unlike the feeder there is no `current_a` to fall back
 * on (that was the 2026-09-02 ruling 6, which moved the feeder's `overload`
 * onto `current_a`). The asymmetry is in the source, not in this entry: §3 and
 * §5 embed their own metering rows (`gen_*`, `ac_*`) and §2 does not, because
 * the tag list's own cross-cutting note says a transformer asset is *"§1 on its
 * LV feeder + §2"*. **A v2 redline candidate for the tag list** — and the fix
 * on a site is a feeder/incomer template on the LV side, never an invented row
 * here. `stock-catalog/electrical-classes.spec.ts` asserts the absence of an
 * `overload` alarm with that reason, so this is a checked claim and not a note.
 *
 * **THE DEFERRED DERIVED CODES**, each with the reason it is named rather than
 * placeholdered (ADR 0051 Amendment 6 decision 8: a code with no formula is not
 * vocabulary):
 *
 *  - `load_pct` = LV kVA ÷ rating (page-9's *Load 72%*) — the rating is an
 *    asset attribute, and there is no LV kVA row to divide (above).
 *  - `lv_load_pct` — another asset's §1 meter.
 *  - `hot_spot_estimate_c` — the IEC 60076-7 thermal model needs exponents the
 *    grammar has no operator for.
 *  - `loss_of_life_pct_day` — IEEE C57.91's ageing factor is exponential.
 *  - `duval_triangle_zone` — a triangle-zone lookup, not an arithmetic
 *    expression.
 *  - `tap_changes_per_day` — a time window the grammar has no state for.
 *
 * The tag list's **overload (load %)** alarm is deferred with them, for the
 * headline reason above.
 *
 * **THE ONE AUTHORED FORMULA.** `oil_rise_over_ambient_c` =
 * `{top_oil_temp_c} - {ambient_temp_c}`, `streaming`, and **`maxInputAgeSeconds:
 * 3600` rather than the 300 s default** (plan §4.2): `ambient_temp_c` is
 * typically a slow-updating site sensor, and at the default the formula
 * silently never fires — which reads as *"the feature is broken"* and is the
 * harder failure to diagnose than a stale input. Top-oil rise over ambient is
 * the figure IEC 60076-7 loading judgements start from, which is why the tag
 * list names it and this entry authors it.
 *
 * **THE TWO KPIs, and the qualification one of them must carry.**
 *
 *  - `winding_to_oil_gradient_c` = `{winding_temp_c} - {top_oil_temp_c}`. The
 *    gradient a rising winding hot spot widens before either absolute
 *    temperature reaches its own alarm stage.
 *  - `monitored_gas_sum_ppm` = the sum of the four online DGA rows. **This is
 *    NOT TDCG.** IEEE C57.104's total dissolved combustible gas is **six**
 *    gases; §2 monitors four — there is no C₂H₄ (ethylene) and no C₂H₆
 *    (ethane) row. A figure that looks like a standard and is not is worse than
 *    no figure, so the qualification is in the KPI's own `name` (*"four of
 *    six"*), where an operator reads it, as well as here. **A v2 redline
 *    candidate: add C₂H₄ and C₂H₆ to §2 and this becomes a real TDCG.**
 *
 * **THE FOUR `M` ROWS ARE THE FIRST `meta.tier: "manual"` ANYWHERE** —
 * `F2.13`'s feeder had none. One consequence, stated and not solved here: an
 * `M` row carries `sourceDataKeyPattern: null` forever, so
 * `AssetTemplateInstantiationService` lists it in `skippedPoints` and it
 * **never gets an `asset_points` row** — which means `F1.8` manual entry has
 * nothing to attach a reading to yet. A flag for `F1.8`; it is a manual-entry
 * data-model question, not a catalog one.
 *
 * **ALARMS — 15 philosophy rows, every one pair-absent** (ADR 0019
 * Amendment 2 decisions 1 and 2; B7: limit values are set per site at
 * commissioning). **§2 carries ELEVEN alarm bullets, not the twelve plan §5.1
 * names** — counted on the document, and the 15 rows reconcile from eleven:
 * the three alarm/trip pairs the tag list already writes as pairs split into
 * six rows, *"cooling fan/pump failure"* into two, *"DGA H₂ or C₂H₂ rising"*
 * into two (they are different faults with different responses), plus five
 * singles, less the deferred `overload`. The plan's derivation sentence is off
 * by one; its count of 15 is right. No `thresholdValue`, no
 * `operator`; the meaning is carried by `message`. `oil_bdv_low` binds an `M`
 * row and `cooling_failure` binds an `X` row — both legal, because
 * `assertContentRefsResolve` requires the key to be *declared*, not required.
 *
 * **UNITS.** `null` wherever `UNIT_BY_KEY` holds `""` — the eleven `0/1`
 * contacts and flags, `tap_position`'s "tap", `oltc_operation_count`'s "count"
 * and `silica_gel_state`'s "enum". A template `unit` is an *override*; `null`
 * defers to the catalog's own unit. Where §2 names a unit it is spelled as
 * `packages/db/src/point-keys-seed.ts` spells it (`°C`, `ppm`, `kV`, `MΩ`).
 * Labels drop the table's editorial remarks (`(manual)`).
 *
 * ---
 *
 * **VERSION HISTORY** (ADR 0052 decision 6): a change to a shipped entry is a
 * new `stockVersion`, recorded here, taken by an organization through a
 * re-import (decision 4), never by mutating its row.
 *
 *  - `electrical-transformer` **v1** (2026-09-02, `F2.12`): authored from
 *    `electrical-derived-taglist-v1.md` §2, PROVISIONAL — derived, not
 *    client-confirmed. The client-confirmed release is v2; its redline
 *    candidates are recorded above (a loading row, C₂H₄ and C₂H₆).
 */
export const ELECTRICAL_TRANSFORMER: StockAssetTemplateEntry = {
  code: "electrical-transformer",
  name: "Transformer — oil-immersed distribution / power",
  assetType: "transformer",
  domain: "electrical",
  description:
    "Oil-immersed distribution or power transformer with OTI/WTI, Buchholz and (optionally) " +
    "online DGA. A dry-type unit drops the oil rows and keeps the winding RTDs. Authored from " +
    "docs/electrical-derived-taglist-v1.md §2 (PROVISIONAL — derived from industry practice, " +
    "not client-confirmed). A transformer is this table PLUS a feeder/incomer template on its LV " +
    "side; the loading figures live there. Tier C points are required, X optional, M entered by " +
    "hand; alarm rows carry a meaning and no limit.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "oti_alarm",
        pointKey: "oti_alarm",
        severity: "warning",
        category: "operations",
        message:
          "Oil temperature indicator alarm stage — the page-9 Oil Temperature High condition. " +
          "The stage is set per site at commissioning.",
      },
      {
        code: "oti_trip",
        pointKey: "oti_trip",
        severity: "critical",
        category: "safety",
        message:
          "Oil temperature indicator trip stage — the transformer is being taken off supply.",
      },
      {
        code: "wti_alarm",
        pointKey: "wti_alarm",
        severity: "warning",
        category: "operations",
        message: "Winding temperature indicator alarm stage.",
      },
      {
        code: "wti_trip",
        pointKey: "wti_trip",
        severity: "critical",
        category: "safety",
        message: "Winding temperature indicator trip stage.",
      },
      {
        code: "buchholz_alarm",
        pointKey: "buchholz_alarm",
        severity: "warning",
        category: "safety",
        message:
          "Gas accumulating in the Buchholz relay — an incipient internal fault. Investigate " +
          "before it becomes a trip.",
      },
      {
        code: "buchholz_trip",
        pointKey: "buchholz_trip",
        severity: "critical",
        category: "safety",
        message: "Buchholz surge trip — a fault inside the tank.",
      },
      {
        code: "oil_level_low",
        pointKey: "oil_level_low",
        severity: "warning",
        category: "safety",
        message:
          "Conservator oil level below the low switch — loss of insulation and cooling medium.",
      },
      {
        code: "prv_operated",
        pointKey: "prv_operated",
        severity: "critical",
        category: "safety",
        message: "Pressure relief valve has operated — a sudden internal pressure rise.",
      },
      {
        code: "cooling_failure",
        pointKey: "cooling_fan_status",
        severity: "warning",
        category: "operations",
        message:
          "Cooling fans not running while oil temperature is rising — the alarm the site pairs " +
          "with top_oil_temp_c.",
      },
      {
        code: "cooling_pump_failure",
        pointKey: "cooling_pump_status",
        severity: "warning",
        category: "operations",
        message: "Forced-oil pump not running on an OFAF/ODAF unit.",
      },
      {
        code: "dga_h2_rising",
        pointKey: "dga_h2_ppm",
        severity: "warning",
        category: "operations",
        message:
          "Dissolved hydrogen rising — a hot spot or partial discharge developing. The rate of " +
          "rise matters more than the absolute value; both are set per site.",
      },
      {
        code: "dga_c2h2_present",
        pointKey: "dga_c2h2_ppm",
        severity: "critical",
        category: "safety",
        message: "Acetylene present — arcing inside the tank.",
      },
      {
        code: "oil_moisture_high",
        pointKey: "oil_moisture_ppm",
        severity: "warning",
        category: "operations",
        message:
          "Oil moisture above the site limit — reduced dielectric strength and accelerated paper " +
          "ageing.",
      },
      {
        code: "oltc_operations_abnormal",
        pointKey: "oltc_operation_count",
        severity: "info",
        category: "operations",
        message:
          "On-load tap changer operating far more or far less than expected — contact wear or a " +
          "stuck regulator.",
      },
      {
        code: "oil_bdv_low",
        pointKey: "oil_bdv_kv",
        severity: "warning",
        category: "operations",
        message:
          "Laboratory breakdown voltage below the site acceptance value — schedule filtration or " +
          "replacement.",
      },
    ],
    kpis: [
      {
        code: "winding_to_oil_gradient_c",
        name: "Winding-to-oil gradient",
        unit: "°C",
        pointKeys: ["winding_temp_c", "top_oil_temp_c"],
        expression: "{winding_temp_c} - {top_oil_temp_c}",
        dialect: "bms-calc-v1",
        higherIsBetter: false,
      },
      {
        // NOT TDCG — four of C57.104's six gases; §2 has no ethylene or ethane
        // row. The qualification is in the name because that is what an
        // operator reads. See the module docblock.
        code: "monitored_gas_sum_ppm",
        name: "Monitored dissolved gases (four of six)",
        unit: "ppm",
        pointKeys: ["dga_h2_ppm", "dga_ch4_ppm", "dga_co_ppm", "dga_c2h2_ppm"],
        expression: "{dga_h2_ppm} + {dga_ch4_ppm} + {dga_co_ppm} + {dga_c2h2_ppm}",
        dialect: "bms-calc-v1",
        higherIsBetter: false,
      },
    ],
    maintenance: [
      {
        title: "Oil sample — BDV, moisture and DGA",
        category: "predictive",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 120,
        priority: "high",
        safetyCritical: false,
        complianceRef: "IEEE C57.106 / IS 1866",
        triggerSummary:
          "Draw an oil sample and send it for breakdown voltage, moisture and dissolved-gas " +
          "analysis. The results are entered by hand on oil_bdv_kv and oil_moisture_lab_ppm; the " +
          "lab's own DGA summary has no point key at all (unit text) and stays with the report.",
      },
      {
        title: "Protection device function test — Buchholz, PRV, OTI and WTI contacts",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 90,
        priority: "high",
        safetyCritical: true,
        triggerSummary:
          "Prove that each alarm and trip contact operates. These are the contacts the eight " +
          "protection alarms on this template bind to, so an untested contact makes eight alarm " +
          "rows into philosophy with no instrument behind them.",
      },
      {
        title: "Breather silica gel inspection and change",
        category: "inspection_round",
        generationMode: "calendar",
        intervalDays: 30,
        estimatedMinutes: 20,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Inspect the breather and change or reactivate the silica gel. The colour is recorded " +
          "by hand on silica_gel_state.",
      },
      {
        title: "Insulation resistance (megger) test",
        category: "predictive",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 90,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Requires an outage. The result is entered by hand on insulation_resistance_mohm.",
      },
      {
        title: "Cooling fan and pump function test",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 91,
        estimatedMinutes: 45,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Run each ONAF fan and each OFAF/ODAF oil pump and confirm that cooling_fan_status and " +
          "cooling_pump_status respond — the two points the cooling alarms bind to.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "top_oil_temp_c", label: "Top-oil temperature (OTI)", unit: "°C", required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "winding_temp_c", label: "Winding temperature (WTI, hottest phase)", unit: "°C", required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "winding_temp_r_c", label: "Winding temperature R (fibre-optic / RTD)", unit: "°C", required: false, sortOrder: 2, meta: EXTENDED },
    { ...MEASURED, pointKey: "winding_temp_y_c", label: "Winding temperature Y", unit: "°C", required: false, sortOrder: 3, meta: EXTENDED },
    { ...MEASURED, pointKey: "winding_temp_b_c", label: "Winding temperature B", unit: "°C", required: false, sortOrder: 4, meta: EXTENDED },
    { ...MEASURED, pointKey: "ambient_temp_c", label: "Ambient at transformer", unit: "°C", required: false, sortOrder: 5, meta: EXTENDED },
    { ...MEASURED, pointKey: "oil_level_pct", label: "Conservator oil level", unit: "%", required: false, sortOrder: 6, meta: EXTENDED },
    { ...MEASURED, pointKey: "oil_level_low", label: "Oil level low switch", unit: null, required: true, sortOrder: 7, meta: CORE },
    { ...MEASURED, pointKey: "buchholz_alarm", label: "Buchholz gas alarm", unit: null, required: true, sortOrder: 8, meta: CORE },
    { ...MEASURED, pointKey: "buchholz_trip", label: "Buchholz surge trip", unit: null, required: true, sortOrder: 9, meta: CORE },
    { ...MEASURED, pointKey: "prv_operated", label: "Pressure relief valve operated", unit: null, required: false, sortOrder: 10, meta: EXTENDED },
    { ...MEASURED, pointKey: "oti_alarm", label: "OTI alarm contact", unit: null, required: true, sortOrder: 11, meta: CORE },
    { ...MEASURED, pointKey: "oti_trip", label: "OTI trip contact", unit: null, required: true, sortOrder: 12, meta: CORE },
    { ...MEASURED, pointKey: "wti_alarm", label: "WTI alarm contact", unit: null, required: true, sortOrder: 13, meta: CORE },
    { ...MEASURED, pointKey: "wti_trip", label: "WTI trip contact", unit: null, required: true, sortOrder: 14, meta: CORE },
    { ...MEASURED, pointKey: "tap_position", label: "OLTC tap position", unit: null, required: false, sortOrder: 15, meta: EXTENDED },
    { ...MEASURED, pointKey: "oltc_in_progress", label: "Tap change in progress", unit: null, required: false, sortOrder: 16, meta: EXTENDED },
    { ...MEASURED, pointKey: "oltc_operation_count", label: "OLTC operations, cumulative", unit: null, required: false, sortOrder: 17, meta: EXTENDED },
    { ...MEASURED, pointKey: "cooling_fan_status", label: "ONAF fan(s) running", unit: null, required: false, sortOrder: 18, meta: EXTENDED },
    { ...MEASURED, pointKey: "cooling_pump_status", label: "OFAF/ODAF oil pump running", unit: null, required: false, sortOrder: 19, meta: EXTENDED },
    { ...MEASURED, pointKey: "dga_h2_ppm", label: "Dissolved hydrogen (online DGA)", unit: "ppm", required: false, sortOrder: 20, meta: EXTENDED },
    { ...MEASURED, pointKey: "dga_c2h2_ppm", label: "Dissolved acetylene (online DGA)", unit: "ppm", required: false, sortOrder: 21, meta: EXTENDED },
    { ...MEASURED, pointKey: "dga_ch4_ppm", label: "Dissolved methane (online DGA)", unit: "ppm", required: false, sortOrder: 22, meta: EXTENDED },
    { ...MEASURED, pointKey: "dga_co_ppm", label: "Dissolved CO (cellulose)", unit: "ppm", required: false, sortOrder: 23, meta: EXTENDED },
    { ...MEASURED, pointKey: "oil_moisture_ppm", label: "Oil moisture (online)", unit: "ppm", required: false, sortOrder: 24, meta: EXTENDED },
    // The four M rows — entered by hand (F1.8 / F1.9), never mapped from a
    // data key. The first `meta.tier: "manual"` anywhere in the catalog.
    { ...MEASURED, pointKey: "oil_bdv_kv", label: "Oil breakdown voltage (lab, periodic)", unit: "kV", required: false, sortOrder: 25, meta: MANUAL },
    { ...MEASURED, pointKey: "oil_moisture_lab_ppm", label: "Oil moisture (lab, periodic)", unit: "ppm", required: false, sortOrder: 26, meta: MANUAL },
    { ...MEASURED, pointKey: "silica_gel_state", label: "Breather silica gel colour", unit: null, required: false, sortOrder: 27, meta: MANUAL },
    { ...MEASURED, pointKey: "insulation_resistance_mohm", label: "Megger insulation resistance", unit: "MΩ", required: false, sortOrder: 28, meta: MANUAL },
    // Derived, appended after the table rows. 3600 s and not the 300 s default:
    // ambient_temp_c is a slow-updating site sensor — see the module docblock.
    {
      ...derived("{top_oil_temp_c} - {ambient_temp_c}", { maxInputAgeSeconds: 3600 }),
      pointKey: "oil_rise_over_ambient_c",
      label: "Top-oil rise over ambient",
      unit: "°C",
      required: false,
      sortOrder: 29,
    },
  ],
};
