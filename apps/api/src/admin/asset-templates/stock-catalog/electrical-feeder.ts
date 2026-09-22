import { CALC_DIALECT_V2, CALC_DIALECT_V3, DASHBOARD_GRID } from "@bms/shared";

import { CORE, derived, EXTENDED, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The electrical pack's feeder / incomer class — `F2.13`, ADR 0052 decisions
 * 1, 2 and 6.
 *
 * **Moved out of `electrical.ts` by `F2.12` when that file reached the §4.5
 * cap. Text only — no point, alarm, unit, label, tier or sort order changed,
 * which is why `F2.12` did not bump `stockVersion`.** `F2.8` did, to **2**: it
 * appends three `bms-calc-v2` derived rows. `E4.1c` did, to **3**: it appends
 * six `bms-calc-v3` sustainability rows. See VERSION HISTORY below.
 *
 * ---
 *
 * **SOURCE.** `docs/electrical-derived-taglist-v1.md` §1 — *"Feeder / incomer —
 * multifunction energy meter (HT panel, LT panel, MCC feeder, sub-meter)"*.
 * All 33 rows, in the table's own order (`sortOrder` 0…32), `label` from the
 * Description column, `unit` from the Unit column. **The nine DERIVED rows at
 * `sortOrder` 33–41 are not in that document** — three are `F2.8`'s, six are
 * `E4.1c`'s (ADR 0070 decision 8), and the VERSION HISTORY below is their
 * provenance. The entry's `description`
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
 * point unmapped at instantiation, visibly. **Re-ruled the same way for
 * `E4.1c` (plan Q3, 2026-09-19):** `bms-calc-v3` CAN now write
 * `delta({kwh_total}, today)`, and `kwh_today` still stays MEASURED — a
 * derived `kwh_today` would be a second, one-tick-old answer to the meter's
 * own register. The today-quantities below (`energy_cost_today`,
 * `co2_kg_today`, `energy_saving_vs_baseline_pct`) read the window inline
 * themselves, never `{kwh_today}`.
 *
 * **FIVE OF THE SIX "Derived:" CODES ARE DEFERRED, NOT AUTHORED** — ADR 0051
 * Amendment 6 decision 8: a code with no formula is not vocabulary, so none of
 * them is promoted into `ELECTRICAL_CLASS_POINT_KEYS`. **`demand_vs_contract_pct`
 * left the ledger with `E4.1c`** — `bms-calc-v3`'s `$contract_demand_kva`
 * (ADR 0070 decision 2) is exactly the attribute it needed; it is authored at
 * `sortOrder` 41 below. Each of the five that stay needs something the
 * grammar still cannot name (ADR 0036; `F2.9` records the fork):
 *
 *  - `load_pct` = kVA ÷ rating — needs the asset's kVA rating, an asset
 *    attribute.
 *  - `demand_vs_contract_pct` = demand ÷ contract demand (the page-9 KPI) —
 *    needed the contract demand, an asset attribute. **Authored by `E4.1c`**
 *    over `$contract_demand_kva`; kept in this list so the tag list's six are
 *    all accounted for.
 *  - `pf_penalty_flag` vs the tariff PF band — needs the tariff band, a site
 *    attribute.
 *  - `kwh_per_unit_output` — needs production, a value from another asset.
 *  - `specific_energy_kwh_kl` — needs KL throughput, a value from another
 *    asset.
 *  - `losses_pct` = incomer − Σ feeders. `bms-calc-v2` (ADR 0055) CAN now
 *    express a cross-asset Σ — `F2.8`'s `site_kw` below is one — so the grammar
 *    is no longer the obstacle. It stays deferred because the tag list's own
 *    definition needs the FEEDER SET the incomer is measured against, and
 *    naming that set is `F2.12`-era content — `F2.22` closed without it, out of
 *    that row's own plan scope. A formula summing the wrong scope would compute
 *    a real number under the wrong name, which is worse than a named deferral.
 *
 * **Nine `kind: "derived"` points — three since `F2.8`, six since `E4.1c` —
 * and no `content.kpis`.** `F2.8`'s three are not tag-list rows and not
 * promotions of the six above: they are ruling 1 of `F2.8`'s gate
 * (2026-09-05) — PUE on the site's incomer, and nowhere else. `E4.1c`'s six
 * are ADR 0070 decision 8's sustainability points (plan §3.7): a cost and a
 * carbon rate from `{kw}`, a cost and a carbon mass today from
 * `delta({kwh_total}, today)`, a saving against a daily baseline prorated by
 * `hours(today)`, and the one promotion, `demand_vs_contract_pct`. Every
 * `$key` is a `bms.calc_parameters` row the tenant enters on
 * `/admin/calc-parameters`; until it exists the point refuses
 * `parameter_unset`, counted, never a number.
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
 *    `packages/db/src/point-key-units.ts`'s `UNIT_BY_KEY` spells it —
 *    `kVAr`, `kVArh`, not the table's `kVAR`/`kVARh`. **The two money rows
 *    are the one exception**: `energy_cost_per_h` and `energy_cost_today`
 *    carry `unit: ""` explicitly (plan Q8, ruled 2026-09-19) — the amount's
 *    dimension is the tenant's `bms.organizations.currency`, not the code's,
 *    and the empty string on the template row says so where `null` would
 *    only defer to the catalog's identical `""`.
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
 *    client-confirmed. The client-confirmed redline is recorded in this list
 *    when it arrives.
 *  - `electrical-feeder` **v2** (2026-09-05, `F2.8`): three `bms-calc-v2`
 *    derived points appended at `sortOrder` 33–35, per the owner's ruling 1 of
 *    2026-09-05 — `site_kw = sum({kw} @site)`, `it_kw = sum({kw}
 *    @group('IT_LOAD'))` and `pue = {site_kw} / {it_kw}`. Four things a tenant
 *    importing this release must know:
 *
 *      1. **`IT_LOAD` is a reserved group code the importing organization
 *         creates per site.** `bms.asset_groups` is unique on
 *         `(location_id, code)`, and `@group('…')` resolves against the owning
 *         asset's location (ADR 0055 decision 9), so the group is per site and
 *         `it_kw` covers exactly the IT feeders that site put in it. Until the
 *         group exists the aggregate resolves to no members and nothing is
 *         written — visible, not wrong. A tenant that prefers another code
 *         edits the formula on the imported draft.
 *      2. **`minCoverageRatio` is `null`, which is FAIL CLOSED** (ADR 0055
 *         decision 11): every declared member must carry a fresh value or the
 *         tick writes nothing. That is the default on purpose; relaxing it is
 *         the importing tenant's own visible edit on the draft.
 *      3. **The value is at most one 60 s tick old** — ADR 0055 decision 10's
 *         cost. A `v2` formula resolves its membership once per sweep, so it
 *         cannot be streaming, and `pue` reads two derived siblings on its own
 *         asset (decision 7), which the sweep resolves in the same tick.
 *      4. **The incomer is the owner of the point**, not every asset and not a
 *         site-level role. On a panel or a sub-meter these three rows simply
 *         compute the same site figures again; a tenant that does not want
 *         that deletes them from the draft.
 *  - `electrical-feeder` **v3** (2026-09-19, `E4.1c`): six `bms-calc-v3`
 *    derived points appended at `sortOrder` 36–41, ADR 0070 decision 8 as
 *    ruled on 2026-09-19 (plan §3.7) — `energy_cost_per_h`, `co2_kg_per_h`,
 *    `energy_cost_today`, `co2_kg_today`, `energy_saving_vs_baseline_pct` and
 *    `demand_vs_contract_pct` (the ledger promotion). Four things a tenant
 *    importing this release must know:
 *
 *      1. **A `$key` with no value is a counted `parameter_unset`**, not a
 *         number, until the tenant enters it on `/admin/calc-parameters` —
 *         `energy_tariff_per_kwh`, `grid_carbon_factor_kgco2_per_kwh`,
 *         `energy_baseline_kwh_per_day`, `contract_demand_kva`; the nearest
 *         scope (asset, location, organization) wins (ADR 0070 decision 2).
 *         The money points carry the empty-string unit: the amount is in
 *         `bms.organizations.currency`, the tenant's, not the code's.
 *      2. **A `today` window needs the location's time zone**
 *         (`locations.timezone`, ADR 0070 Amendment 1); an asset at a
 *         location without one refuses `timezone_unset`. At the first tick
 *         after local midnight the `today` window is empty, so the three
 *         `today` rows refuse `window_empty` for one tick — the scheduler
 *         resolves every window read before `evaluate()`, so the division by
 *         `hours(today) = 0` in `energy_saving_vs_baseline_pct` is never
 *         reached.
 *      3. **The value is at most one 60 s tick old** — every row is
 *         `scheduled`, the ADR 0055 decision 10 cost; no coverage guard
 *         applies (`minCoverageRatio` governs a `@scope` aggregate only,
 *         ADR 0055 decision 11) — a window with no samples refuses
 *         `window_empty`.
 *      4. **`max_demand_kva` is tier X** — an asset that has not mapped it
 *         refuses `demand_vs_contract_pct` as `missing_input`, visibly.
 *         `kwh_today` stays MEASURED (Q3): the today rows read
 *         `delta({kwh_total}, today)` themselves.
 * *  - `electrical-feeder` **v4** (2026-09-22, `E4.2` PR 2): six more `bms-calc-v3`
 *    derived points appended at `sortOrder` 42–47 (ADR 0072 decision 3, Q7
 *    ruling (a), plan §3.7) — `kwh_this_month`, `kwh_this_year`,
 *    `energy_cost_this_month`, `energy_cost_this_year`, `co2_kg_this_month`,
 *    `co2_kg_this_year`. `kwh_this_month`/`_this_year` are the ONLY new
 *    codes here with no `$key`: they read `delta({kwh_total}, …)` alone —
 *    `kwh_today` stays MEASURED, but a monthly or annual register does not
 *    exist on the meter, so the window rows are DERIVED (unlike `kwh_today`,
 *    Q3 does not apply). The four cost/CO₂ rows price the WHOLE calendar
 *    period at the `$key` effective at the evaluation instant (Q7): a
 *    mid-period tariff or factor change re-prices the whole period from the
 *    next sweep, never a piecewise figure — each label says so.
 *
 * **`content.dashboards.overview` — F3.2 (ADR 0067 decision 6).** One view, tiling the
 * class's headline measured points as `value_tile`s in table order (kw, kva, pf, current_a, frequency_hz, kwh_today, breaker_main, meter_comms_ok), plus one
 * `chart` trending kw, kva. Every key is a declared `kind: "measured"` point with
 * `meta.tier !== "manual"` on this entry — the two kinds F3.2's instantiation hook can
 * always bind (a manual row is never populated at instantiation; a derived key has no
 * `asset_points` row to read). No `stockVersion` bump — the owner did not rule a release
 * for this content addition (plan §12 Q9, ADR 0067 §13).
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
  stockVersion: 4,
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
    dashboards: {
      overview: {
        featured: ["kw", "kva", "pf", "current_a", "frequency_hz", "kwh_today", "breaker_main", "meter_comms_ok"],
        widgets: [
          {
            title: "Active power, total",
            widgetType: "value_tile",
            pointKeys: ["kw"],
            config: {},
            gridX: 0,
            gridY: 0,
            gridW: 3,
            gridH: 2,
          },
          {
            title: "Apparent power, total",
            widgetType: "value_tile",
            pointKeys: ["kva"],
            config: {},
            gridX: 3,
            gridY: 0,
            gridW: 3,
            gridH: 2,
          },
          {
            title: "Power factor, total",
            widgetType: "value_tile",
            pointKeys: ["pf"],
            config: {},
            gridX: 6,
            gridY: 0,
            gridW: 3,
            gridH: 2,
          },
          {
            title: "Average / total current",
            widgetType: "value_tile",
            pointKeys: ["current_a"],
            config: {},
            gridX: 9,
            gridY: 0,
            gridW: 3,
            gridH: 2,
          },
          {
            title: "Frequency",
            widgetType: "value_tile",
            pointKeys: ["frequency_hz"],
            config: {},
            gridX: 0,
            gridY: 2,
            gridW: 3,
            gridH: 2,
          },
          {
            title: "Energy today",
            widgetType: "value_tile",
            pointKeys: ["kwh_today"],
            config: {},
            gridX: 3,
            gridY: 2,
            gridW: 3,
            gridH: 2,
          },
          {
            title: "Breaker closed / open",
            widgetType: "value_tile",
            pointKeys: ["breaker_main"],
            config: {},
            gridX: 6,
            gridY: 2,
            gridW: 3,
            gridH: 2,
          },
          {
            title: "Meter reachable",
            widgetType: "value_tile",
            pointKeys: ["meter_comms_ok"],
            config: {},
            gridX: 9,
            gridY: 2,
            gridW: 3,
            gridH: 2,
          },
          {
            title: "Power trend",
            widgetType: "chart",
            pointKeys: ["kw", "kva"],
            config: { series: "line" },
            gridX: 0,
            gridY: 4,
            gridW: DASHBOARD_GRID.columns,
            gridH: 4,
          },
        ],
      },
    },
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
    // `F2.8` — PUE, appended after the tag list's rows. Two aggregates and the
    // ratio of them; `pue` reads its two derived siblings, which ADR 0055
    // decision 7 admits and the sweep resolves in the same tick. No `meta`:
    // `meta.tier` says what the plant has FITTED, and nothing fits a computed
    // point. `minCoverageRatio` is left at `derived()`'s null — fail closed.
    {
      ...derived("sum({kw} @site)", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V2 }),
      pointKey: "site_kw",
      label: "Site load (Σ kW at this site)",
      unit: "kW",
      required: false,
      sortOrder: 33,
    },
    {
      ...derived("sum({kw} @group('IT_LOAD'))", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V2 }),
      pointKey: "it_kw",
      label: "IT load (Σ kW, group IT_LOAD)",
      unit: "kW",
      required: false,
      sortOrder: 34,
    },
    {
      ...derived("{site_kw} / {it_kw}", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V2 }),
      pointKey: "pue",
      label: "PUE",
      unit: null,
      required: false,
      sortOrder: 35,
    },
    // `E4.1c` — ADR 0070 decision 8, plan §3.7. Six `bms-calc-v3` rows, every
    // one scheduled at 60 s; no coverage guard applies (`minCoverageRatio`
    // governs a `@scope` aggregate only, ADR 0055 decision 11) and no
    // `meta` (nothing fits a computed point). Each `$key` is a `0074`
    // parameter; each window read is inline, never a derived sibling's. The
    // money rows carry `unit: ""` — the organization's currency (Q8).
    {
      ...derived("{kw} * $energy_tariff_per_kwh", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V3 }),
      pointKey: "energy_cost_per_h",
      label: "Energy cost rate (organization currency per hour)",
      unit: "",
      required: false,
      sortOrder: 36,
    },
    {
      ...derived("{kw} * $grid_carbon_factor_kgco2_per_kwh", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V3 }),
      pointKey: "co2_kg_per_h",
      label: "CO₂ emission rate",
      unit: "kg/h",
      required: false,
      sortOrder: 37,
    },
    {
      ...derived("delta({kwh_total}, today) * $energy_tariff_per_kwh", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V3 }),
      pointKey: "energy_cost_today",
      label: "Energy cost today (organization currency)",
      unit: "",
      required: false,
      sortOrder: 38,
    },
    {
      ...derived("delta({kwh_total}, today) * $grid_carbon_factor_kgco2_per_kwh", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V3 }),
      pointKey: "co2_kg_today",
      label: "CO₂ emitted today",
      unit: "kg",
      required: false,
      sortOrder: 39,
    },
    {
      ...derived("(1 - delta({kwh_total}, today) / ($energy_baseline_kwh_per_day * hours(today) / 24)) * 100", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V3 }),
      pointKey: "energy_saving_vs_baseline_pct",
      label: "Energy saving vs baseline, today",
      unit: "%",
      required: false,
      sortOrder: 40,
    },
    // The tag list's own "Derived:" row — the ledger promotion. `max_demand_kva`
    // is tier X, so an asset without it refuses `missing_input`.
    {
      ...derived("{max_demand_kva} / $contract_demand_kva * 100", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V3 }),
      pointKey: "demand_vs_contract_pct",
      label: "Maximum demand vs contract demand",
      unit: "%",
      required: false,
      sortOrder: 41,
    },
    // `E4.2` PR 2 — ADR 0072 decision 3, Q7 ruling (a), plan §3.7. Six more
    // bms-calc-v3 rows: the calendar-window siblings of energy_cost_today /
    // co2_kg_today, plus the two derived kwh windows (kwh_today stays
    // MEASURED per Q3; a monthly/annual register does not exist). Every cost
    // and CO₂ code prices the whole period at the $key effective at
    // evaluation (Q7) — the label says so.
    {
      ...derived("delta({kwh_total}, this_month)", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V3 }),
      pointKey: "kwh_this_month",
      label: "Energy this month (calendar)",
      unit: "kWh",
      required: false,
      sortOrder: 42,
    },
    {
      ...derived("delta({kwh_total}, this_year)", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V3 }),
      pointKey: "kwh_this_year",
      label: "Energy this year (calendar)",
      unit: "kWh",
      required: false,
      sortOrder: 43,
    },
    {
      ...derived("delta({kwh_total}, this_month) * $energy_tariff_per_kwh", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V3 }),
      pointKey: "energy_cost_this_month",
      label: "Energy cost this month (at the tariff effective now)",
      unit: "",
      required: false,
      sortOrder: 44,
    },
    {
      ...derived("delta({kwh_total}, this_year) * $energy_tariff_per_kwh", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V3 }),
      pointKey: "energy_cost_this_year",
      label: "Energy cost this year (at the tariff effective now)",
      unit: "",
      required: false,
      sortOrder: 45,
    },
    {
      ...derived("delta({kwh_total}, this_month) * $grid_carbon_factor_kgco2_per_kwh", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V3 }),
      pointKey: "co2_kg_this_month",
      label: "CO₂ emitted this month (at the factor effective now)",
      unit: "kg",
      required: false,
      sortOrder: 46,
    },
    {
      ...derived("delta({kwh_total}, this_year) * $grid_carbon_factor_kgco2_per_kwh", { calcTrigger: "scheduled", calcIntervalSeconds: 60, formulaDialect: CALC_DIALECT_V3 }),
      pointKey: "co2_kg_this_year",
      label: "CO₂ emitted this year (at the factor effective now)",
      unit: "kg",
      required: false,
      sortOrder: 47,
    },
  ],
};
