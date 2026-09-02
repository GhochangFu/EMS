import { CORE, EXTENDED, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The electrical pack's feeder / incomer class — `F2.13`, ADR 0052 decisions
 * 1, 2 and 6.
 *
 * **Moved out of `electrical.ts` by `F2.12` when that file reached the §4.5
 * cap. Text only — no point, alarm, unit, label, tier or sort order changed,
 * which is why `stockVersion` stays 1.**
 *
 * ---
 *
 * **SOURCE.** `docs/electrical-derived-taglist-v1.md` §1 — *"Feeder / incomer —
 * multifunction energy meter (HT panel, LT panel, MCC feeder, sub-meter)"*.
 * All 33 rows, in the table's own order (`sortOrder` 0…32), `label` from the
 * Description column, `unit` from the Unit column. The entry's `description`
 * cites that file and section by name, because **the stamp plus the citation
 * is the provenance** (decision 6): `stock_version = 1` on an imported row *is*
 * "derived-v1", and there is no `meta.provenance`.
 *
 * **TIERS → `meta.tier`** (ADR 0040 decision 3, open question 4): the tag
 * list's `C` is `core` and `required: true`; `X` is `extended` and
 * `required: false`. 17 C rows, 16 X rows. `stock-catalog.spec.ts` holds the
 * split against the entry so a reword cannot drift it.
 *
 * **`kwh_today` is `C/D` and is authored MEASURED.** The table says "meter or
 * derived". No `bms-calc-v1` formula can express energy-today — it needs a
 * time window the grammar cannot name — so authoring it derived would need a
 * placeholder formula, which is the guessing ADR 0019 exists to prevent. A
 * meter that exposes the register supplies it; one that does not leaves the
 * point unmapped at instantiation, visibly.
 *
 * **THE SIX "Derived:" CODES ARE DEFERRED, NOT AUTHORED** — ADR 0051 Amendment
 * 6 decision 8: a code with no formula is not vocabulary, so none of them is
 * promoted into `ELECTRICAL_CLASS_POINT_KEYS` in this row and `tests/f3.38`'s
 * 185 bound does not move. Each one needs something `bms-calc-v1` cannot name
 * (ADR 0036; `F2.9` records the fork):
 *
 *  - `load_pct` = kVA ÷ rating — needs the asset's kVA rating, an asset
 *    attribute.
 *  - `demand_vs_contract_pct` = demand ÷ contract demand (the page-9 KPI) —
 *    needs the contract demand, an asset attribute.
 *  - `pf_penalty_flag` vs the tariff PF band — needs the tariff band, a site
 *    attribute.
 *  - `kwh_per_unit_output` — needs production, a value from another asset.
 *  - `specific_energy_kwh_kl` — needs KL throughput, a value from another
 *    asset.
 *  - `losses_pct` = incomer − Σ feeders — a cross-asset sum the grammar has no
 *    way to express.
 *
 * Zero `kind: "derived"` points, no `content.kpis`. `F2.12` promotes each of
 * these it can actually author a formula for, in its own plan.
 *
 * **ALARMS — 11 philosophy rows, every one pair-absent** (ADR 0019 Amendment 2
 * decisions 1 and 2; B7: limit values are set per site at commissioning). The
 * tag list's ten bullets, with under/over-voltage split into two rows because
 * they are different meanings at different bands. No `thresholdValue`, no
 * `operator`; the meaning is carried by `message`. Severities and categories
 * were **ruled as drafted on 2026-09-02** (plan §12 ruling 5): `critical` for
 * overload, breaker trip and earth fault; `info` for meter comms loss;
 * `warning` for the rest; `safety` for the two protection rows, `energy` for
 * PF and demand, `operations` otherwise. Both vocabularies are closed at
 * import time by `assertTemplateAlarmVocabularies`.
 *
 * **`overload` binds `current_a`, not `load_pct` — ruled 2026-09-02** (plan
 * §12 ruling 6): `load_pct` is deferred, and an alarm may only reference a
 * key the template declares (`assertContentRefsResolve`). Four rows bind
 * `X`-tier optional points (`thd_v_pct`, `voltage_unbalance_pct`, `demand_kw`,
 * `earth_fault_state`) — legal, because the reference check requires the key
 * to be *declared*, not required.
 *
 * ---
 *
 * **WHAT IS DELIBERATELY NOT HERE.**
 *
 *  - **`sourceDataKeyPattern` is `null` on every point.** The pattern is the
 *    site's telemetry wiring (`SITE/{asset_code}/…`), which the tag list does
 *    not know and this catalog must not guess — the same reason the alarm
 *    limits are absent. It is set on the imported draft, per site.
 *    `AssetTemplateInstantiationService` skips a point with no pattern and
 *    says so in its report, so an unwired import instantiates visibly rather
 *    than wrongly.
 *  - **`unit` is `null` where `UNIT_BY_KEY` holds `""`** — `pf` (the table's
 *    "—"), the six `0/1` flags and `relay_trip_code`'s "code". A template
 *    `unit` is an *override*; `null` defers to the catalog's own unit, which
 *    is what those keys carry. Where the table names a unit it is spelled as
 *    `packages/db/src/point-keys-seed.ts`'s `UNIT_BY_KEY` spells it —
 *    `kVAr`, `kVArh`, not the table's `kVAR`/`kVARh`.
 *  - **Labels drop the table's editorial notes** — "(existing key)" and
 *    "(existing key; meter or derived)" are remarks about the vocabulary, not
 *    what an operator should read on a point.
 *  - **No maintenance plans.** The tag list §1 carries none; `F2.12` adds
 *    them with the other classes.
 *
 * ---
 *
 * **VERSION HISTORY — the bump convention (ADR 0052 decision 6).** A change
 * to a shipped entry is a new `stockVersion`, recorded here, taken by an
 * organization through a re-import (decision 4), never by mutating its row.
 *
 *  - `electrical-feeder` **v1** (2026-09-02, `F2.13`): authored from
 *    `electrical-derived-taglist-v1.md` §1, PROVISIONAL — derived, not
 *    client-confirmed. The client-confirmed release is v2, its redline
 *    recorded in this list.
 */
export const ELECTRICAL_FEEDER: StockAssetTemplateEntry = {
  code: "electrical-feeder",
  name: "Feeder / incomer — multifunction energy meter",
  assetType: "feeder",
  domain: "electrical",
  description:
    "The base electrical class: every panel, feeder and sub-meter is this table — an HT " +
    "incomer adds the relay rows, a motor feeder adds the drive rows. Authored from " +
    "docs/electrical-derived-taglist-v1.md §1 (PROVISIONAL — derived from industry practice, " +
    "not client-confirmed). Tier C points are required, tier X optional; alarm rows carry a " +
    "meaning and no limit — limits are set per site at commissioning.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "overload",
        pointKey: "current_a",
        severity: "critical",
        category: "operations",
        message:
          "Load above the feeder's rating — the page-9 Overload (112%) condition. The limit is " +
          "set per site from the feeder rating at commissioning.",
      },
      {
        code: "undervoltage",
        pointKey: "voltage_vry",
        severity: "warning",
        category: "operations",
        message: "Supply voltage below the site band.",
      },
      {
        code: "overvoltage",
        pointKey: "voltage_vry",
        severity: "warning",
        category: "operations",
        message: "Supply voltage above the site band.",
      },
      {
        code: "frequency_out_of_band",
        pointKey: "frequency_hz",
        severity: "warning",
        category: "operations",
        message: "Supply frequency outside the quality band — grid or DG supply quality.",
      },
      {
        code: "pf_low",
        pointKey: "pf",
        severity: "warning",
        category: "energy",
        message: "Power factor below the tariff band — utility penalty exposure.",
      },
      {
        code: "thd_high",
        pointKey: "thd_v_pct",
        severity: "warning",
        category: "operations",
        message:
          "Voltage THD above the site limit — harmonics from VFDs and UPS (the page-9 THD High " +
          "condition).",
      },
      {
        code: "unbalance_high",
        pointKey: "voltage_unbalance_pct",
        severity: "warning",
        category: "operations",
        message: "Voltage unbalance above the site limit — single-phasing or uneven load.",
      },
      {
        code: "breaker_trip",
        pointKey: "breaker_trip",
        severity: "critical",
        category: "safety",
        message: "Breaker tripped on fault; the protection relay's trip code is in relay_trip_code.",
      },
      {
        code: "earth_fault",
        pointKey: "earth_fault_state",
        severity: "critical",
        category: "safety",
        message: "Earth-fault indication from the protection relay.",
      },
      {
        code: "demand_approaching_contract",
        pointKey: "demand_kw",
        severity: "warning",
        category: "energy",
        message: "Present demand approaching the contract demand.",
      },
      {
        code: "meter_comms_loss",
        pointKey: "meter_comms_ok",
        severity: "info",
        category: "operations",
        message: "Meter unreachable — no readings arriving from the energy meter.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "voltage_vry", label: "Line voltage R–Y", unit: "V", required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "voltage_vyb", label: "Line voltage Y–B", unit: "V", required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "voltage_vbr", label: "Line voltage B–R", unit: "V", required: true, sortOrder: 2, meta: CORE },
    { ...MEASURED, pointKey: "voltage_vrn", label: "Phase voltage R–N", unit: "V", required: false, sortOrder: 3, meta: EXTENDED },
    { ...MEASURED, pointKey: "voltage_vyn", label: "Phase voltage Y–N", unit: "V", required: false, sortOrder: 4, meta: EXTENDED },
    { ...MEASURED, pointKey: "voltage_vbn", label: "Phase voltage B–N", unit: "V", required: false, sortOrder: 5, meta: EXTENDED },
    { ...MEASURED, pointKey: "current_ir", label: "Current R", unit: "A", required: true, sortOrder: 6, meta: CORE },
    { ...MEASURED, pointKey: "current_iy", label: "Current Y", unit: "A", required: true, sortOrder: 7, meta: CORE },
    { ...MEASURED, pointKey: "current_ib", label: "Current B", unit: "A", required: true, sortOrder: 8, meta: CORE },
    { ...MEASURED, pointKey: "current_in", label: "Neutral current", unit: "A", required: false, sortOrder: 9, meta: EXTENDED },
    { ...MEASURED, pointKey: "current_a", label: "Average / total current", unit: "A", required: true, sortOrder: 10, meta: CORE },
    { ...MEASURED, pointKey: "kw", label: "Active power, total", unit: "kW", required: true, sortOrder: 11, meta: CORE },
    { ...MEASURED, pointKey: "kvar", label: "Reactive power, total", unit: "kVAr", required: true, sortOrder: 12, meta: CORE },
    { ...MEASURED, pointKey: "kva", label: "Apparent power, total", unit: "kVA", required: true, sortOrder: 13, meta: CORE },
    { ...MEASURED, pointKey: "pf", label: "Power factor, total", unit: null, required: true, sortOrder: 14, meta: CORE },
    { ...MEASURED, pointKey: "frequency_hz", label: "Frequency", unit: "Hz", required: true, sortOrder: 15, meta: CORE },
    { ...MEASURED, pointKey: "kwh_total", label: "Active energy, cumulative", unit: "kWh", required: true, sortOrder: 16, meta: CORE },
    { ...MEASURED, pointKey: "kvah_total", label: "Apparent energy, cumulative", unit: "kVAh", required: false, sortOrder: 17, meta: EXTENDED },
    { ...MEASURED, pointKey: "kvarh_total", label: "Reactive energy, cumulative", unit: "kVArh", required: false, sortOrder: 18, meta: EXTENDED },
    // C/D → core, measured — see the module docblock.
    { ...MEASURED, pointKey: "kwh_today", label: "Energy today", unit: "kWh", required: true, sortOrder: 19, meta: CORE },
    { ...MEASURED, pointKey: "demand_kw", label: "Present demand (sliding window)", unit: "kW", required: false, sortOrder: 20, meta: EXTENDED },
    { ...MEASURED, pointKey: "max_demand_kw", label: "Maximum demand this billing period", unit: "kW", required: false, sortOrder: 21, meta: EXTENDED },
    { ...MEASURED, pointKey: "max_demand_kva", label: "Maximum demand (kVA billing)", unit: "kVA", required: false, sortOrder: 22, meta: EXTENDED },
    { ...MEASURED, pointKey: "thd_v_pct", label: "Voltage THD (worst phase)", unit: "%", required: false, sortOrder: 23, meta: EXTENDED },
    { ...MEASURED, pointKey: "thd_i_pct", label: "Current THD (worst phase)", unit: "%", required: false, sortOrder: 24, meta: EXTENDED },
    { ...MEASURED, pointKey: "voltage_unbalance_pct", label: "Voltage unbalance", unit: "%", required: false, sortOrder: 25, meta: EXTENDED },
    { ...MEASURED, pointKey: "current_unbalance_pct", label: "Current unbalance", unit: "%", required: false, sortOrder: 26, meta: EXTENDED },
    { ...MEASURED, pointKey: "breaker_main", label: "Breaker closed / open", unit: null, required: true, sortOrder: 27, meta: CORE },
    { ...MEASURED, pointKey: "breaker_trip", label: "Breaker tripped on fault", unit: null, required: true, sortOrder: 28, meta: CORE },
    { ...MEASURED, pointKey: "breaker_spring_charged", label: "ACB spring charged (HT/LT incomer)", unit: null, required: false, sortOrder: 29, meta: EXTENDED },
    { ...MEASURED, pointKey: "relay_trip_code", label: "Protection relay last trip (O/C, E/F, U/V)", unit: null, required: false, sortOrder: 30, meta: EXTENDED },
    { ...MEASURED, pointKey: "earth_fault_state", label: "Earth-fault indication", unit: null, required: false, sortOrder: 31, meta: EXTENDED },
    { ...MEASURED, pointKey: "meter_comms_ok", label: "Meter reachable", unit: null, required: true, sortOrder: 32, meta: CORE },
  ],
};
