import { MECHANICAL_TAG_LIST } from "./mechanical-classes.spec";
import { alarmsOf, assert, maintenanceOf, requireStockEntry } from "./stock-catalog.spec";
import {
  assertAlarmTable,
  assertDeferralsAbsent,
  assertDerivedPoints,
  assertEntryIdentity,
  assertMaintenanceBounds,
  assertNoKpis,
  assertPhilosophyRows,
  assertPointTable,
  assertProvenance,
  assertSkillAssignment,
  tierCount,
  type AlarmRow,
  type DerivedRow,
  type PointRow,
} from "./stock-transcription.spec";

/**
 * `E5.2` pass C, the second of three transcription spec files — §3 (air
 * compressor) and §4 (chiller) of `docs/e5.2-derived-taglist-v1.md`.
 *
 * **Two entries per file, three files** — the cap `E5.1` measured at its own
 * first escalation checkpoint, and the §4.5 pre-commit guard reads a whole
 * file. §1 and §2 are in `mechanical-classes.spec.ts`, §3 and §4 here (plan
 * Task 8 and Task 9), §6 and §7 in `-3`. **This file is created with the
 * compressor block alone and the chiller block appends to it** — the runner at
 * the foot is the seam, so Task 9 adds one `check…()` call and nothing else
 * moves.
 *
 * **The two entries in this file are the pack's two heaviest.** The compressor
 * carries the first `safetyCritical` plan in the pack, and the chiller is the
 * first stock entry ever filed under `hvac`, carries five formulas including the
 * two with physical constants, and binds an alarm to one of them (the N5
 * signal). Plan §3's second escalation checkpoint keys on the chiller.
 *
 * **Every helper is imported from `stock-transcription.spec.ts`, not restated**
 * — the same discipline `mechanical-classes.spec.ts` records. `MECHANICAL_TAG_LIST`
 * comes from that sibling rather than being spelled a second time: the document
 * name is a needle `assertProvenance` looks for in every entry's description, and
 * two spellings of it would be two claims that could drift apart.
 *
 * **`mechanical-classes-2.test.ts` is this file's name-sibling wrapper** —
 * `tests/repo-invariants.test.ts` matches the pair by name, and a spec imported
 * from a differently-named wrapper still runs but is absent from coverage.
 */

// ===========================================================================
// §3 — `mechanical-compressor`
// ===========================================================================

const COMPRESSOR_CODE = "mechanical-compressor";

/**
 * §3's 21 table rows in the document's own order (`sortOrder` 0-20), then the
 * two authored derived codes at 21-22 — `[pointKey, tier, unit]`. Reused codes
 * are `oil_temp_c`, `oil_pressure_bar`, `run_hours_h`, `kw`, `kwh_total` and
 * `service_due_h` — **six of the twenty-one, referenced and redeclared nowhere**
 * (ADR 0053 decision 3).
 *
 * `oil_temp_c` and `oil_pressure_bar` are the **DG set's** codes with the same
 * meaning — lubrication oil in a running machine — so the compressor names them
 * rather than minting a `comp_oil_*` pair. `service_due_h` is the controller's
 * own hours-to-service counter, which is why the `service_due` alarm on this
 * entry binds it while the pump's binds `run_hours_h`: a screw compressor's
 * controller counts down to the service and a pump's starter does not.
 *
 * **`fad_m3h` carries `m³/hr` with a U+00B3 SUPERSCRIPT THREE** and
 * `specific_power_kw_m3min` carries `kW/(m³/min)` with the same codepoint,
 * matching `UNIT_BY_KEY` byte for byte. A template `unit` is an override, so a
 * look-alike spelling here (`m3/hr`, or a different superscript) would ship to
 * every organization that imports the entry and could not be corrected by a
 * later seed. `intake_filter_dp_mbar` is `mbar` and not `bar`: an intake filter
 * pressure drop is millibars, and the separator beside it really is `bar`.
 *
 * The four `0/1` and `enum` rows carry `null`, which the vocabulary spells `""`
 * (ADR 0051 Amendment 6 decision 4).
 */
const COMPRESSOR_POINTS: readonly PointRow[] = [
  ["comp_status", "core", null],
  ["comp_load_state", "core", null],
  ["comp_fault", "core", null],
  ["comp_warning", "extended", null],
  ["outlet_pressure_bar", "core", "bar"],
  ["pressure_setpoint_bar", "extended", "bar"],
  ["element_outlet_temp_c", "core", "°C"],
  ["oil_temp_c", "extended", "°C"],
  ["oil_pressure_bar", "extended", "bar"],
  ["intake_filter_dp_mbar", "extended", "mbar"],
  ["oil_separator_dp_bar", "extended", "bar"],
  ["run_hours_h", "core", "h"],
  ["loaded_hours_h", "core", "h"],
  ["motor_current_a", "core", "A"],
  ["kw", "extended", "kW"],
  ["kwh_total", "extended", "kWh"],
  ["dryer_dewpoint_c", "extended", "°C"],
  ["dryer_status", "extended", null],
  ["receiver_pressure_bar", "extended", "bar"],
  ["fad_m3h", "extended", "m³/hr"],
  ["service_due_h", "extended", "h"],
  ["load_factor_pct", "derived", "%"],
  ["specific_power_kw_m3min", "derived", "kW/(m³/min)"],
];

/**
 * §3's two expressible derived codes, as literal strings (plan §5.0).
 *
 * `load_factor_pct` is a **lifetime** ratio of two cumulative counters, which is
 * what the document names: loaded hours over running hours since the machine was
 * commissioned. It is not a windowed load factor — `bms-calc-v1` has no state —
 * and the alarm philosophy on this entry says so rather than implying a rolling
 * figure. Both inputs are tier C.
 *
 * `specific_power_kw_m3min` is kW per cubic metre per minute of free air, the
 * figure every compressed-air audit is written in. The `* 60` converts the
 * document's `m³/hr` FAD into `m³/min` and is a **unit conversion, not a
 * constant with physics in it**; both inputs are tier X, so a house with no
 * air-flow meter simply gets no value — legal, because the reference check
 * requires a key to be DECLARED and not required (ADR 0036 decision 7).
 *
 * Division by zero needs no guard: `evaluate.ts` returns `non_finite`, so load
 * factor before the first run hour and specific power at zero FAD yield no value
 * for that reading rather than a fabricated one. **Neither overrides
 * `maxInputAgeSeconds`** — both are `null`, and there is no `approach_c`-shaped
 * override anywhere in this pack, so a "helpful" one fails here with a reason.
 */
const COMPRESSOR_DERIVED: readonly DerivedRow[] = [
  ["load_factor_pct", "{loaded_hours_h} / {run_hours_h} * 100", null],
  ["specific_power_kw_m3min", "{kw} * 60 / {fad_m3h}", null],
];

/**
 * §3's seven alarm bullets become **seven** rows — one per bullet, the only
 * entry in the pack where nothing splits and nothing merges.
 *
 * **Two of the seven are not `operations`.** `element_outlet_temp_high` is
 * `safety`: on an oil-injected screw the element outlet temperature is the
 * fire-risk trip, and filing it as an operations row would put a fire precursor
 * in the same bucket as a filter change. `separator_dp_high` is `energy`: a
 * loaded separator element makes the machine produce more pressure for the same
 * air, every hour it runs, and that is a continuous cost rather than an event.
 */
const COMPRESSOR_ALARMS: readonly AlarmRow[] = [
  ["compressor_shutdown", "comp_fault", "critical", "operations"],
  ["element_outlet_temp_high", "element_outlet_temp_c", "critical", "safety"],
  ["outlet_pressure_low", "outlet_pressure_bar", "warning", "operations"],
  ["intake_filter_dp_high", "intake_filter_dp_mbar", "warning", "operations"],
  ["separator_dp_high", "oil_separator_dp_bar", "warning", "energy"],
  ["dewpoint_high", "dryer_dewpoint_c", "warning", "operations"],
  ["service_due", "service_due_h", "info", "operations"],
];

/**
 * `mechanical-compressor` against `docs/e5.2-derived-taglist-v1.md` §3 (plan
 * §5.3) — the entry that carries **the pack's first `safetyCritical` plan**, one
 * of exactly three ADR 0053 decision 8 names.
 */
function checkCompressor(): void {
  const entry = requireStockEntry(COMPRESSOR_CODE);
  assertEntryIdentity(COMPRESSOR_CODE, entry, "air_compressor", "mechanical");

  // ---- 23 points, 8 core + 13 extended + 0 manual + 2 derived -------------

  assert(
    tierCount(entry, "core") === 8 &&
      tierCount(entry, "extended") === 13 &&
      tierCount(entry, "manual") === 0 &&
      tierCount(entry, "derived") === 2,
    `§3 marks 8 rows C and 13 X, has no M row, and two of its four derived codes are authored — ` +
      `8/13/0/2. Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(COMPRESSOR_CODE, "§3", entry, COMPRESSOR_POINTS);
  assertDerivedPoints(COMPRESSOR_CODE, entry, COMPRESSOR_DERIVED);
  assertNoKpis(COMPRESSOR_CODE, entry, "§3");
  assertDeferralsAbsent(COMPRESSOR_CODE, entry);

  // ---- load_factor_pct is a ratio of two CUMULATIVE COUNTERS --------------

  for (const pointKey of ["loaded_hours_h", "run_hours_h"]) {
    const counter = entry.points.find((point) => point.pointKey === pointKey);
    assert(
      counter?.meta?.tier === "core" && counter.required === true,
      `${COMPRESSOR_CODE}.${pointKey} must stay tier C and required — §3 marks both hour counters ` +
        "C, and load_factor_pct divides one by the other. Unlike the pump's two formulas, which " +
        "read X-tier inputs and accept getting no value on a site that has not fitted the " +
        "instrument, this one is computable on every compressor the template is imported onto, " +
        `because a controller that reports one hour counter reports both. Got tier ` +
        `${String(counter?.meta?.tier)}, required ${String(counter?.required)}.`,
    );
  }

  // ---- 7 alarms, two of them outside `operations` -------------------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(COMPRESSOR_CODE, "§3", alarms, COMPRESSOR_ALARMS);
  assertPhilosophyRows(COMPRESSOR_CODE, alarms);
  assertSkillAssignment(
    COMPRESSOR_CODE,
    alarms,
    {
      compressor_shutdown: "mechanical",
      element_outlet_temp_high: "mechanical",
      outlet_pressure_low: "mechanical",
      intake_filter_dp_high: "mechanical",
      separator_dp_high: "mechanical",
      dewpoint_high: "mechanical",
      service_due: "mechanical",
    },
    // No process-chemistry row on a compressor house: all four of the pack's
    // no-skill rows are the boiler's. The empty list is a claim, not a gap —
    // assertSkillAssignment requires the map and this list to partition the
    // seven. Every row here is answered by the mechanical trade: an element, a
    // separator, an intake filter, a dryer and a service interval are all its
    // work, and unlike the pump there is no motor-band row for the electrical
    // trade and no controller row for controls.
    [],
  );

  const serviceDue = alarms.find((alarm) => alarm.code === "service_due");
  assert(
    serviceDue?.pointKey === "service_due_h",
    `${COMPRESSOR_CODE}'s service_due alarm must bind service_due_h — the CONTROLLER's own ` +
      "hours-to-next-service counter, which §3 declares and which counts DOWN. The pump carries " +
      "an alarm with the same code binding run_hours_h, because a pump's starter has no such " +
      "counter and the site compares cumulative hours against its own interval. An alarm code is " +
      "unique within an entry only, so the reuse is legal — but the two bind different points on " +
      `purpose, and copying the pump's binding here would alarm on the wrong number. Got ` +
      `"${String(serviceDue?.pointKey)}".`,
  );

  // ---- 4 maintenance plans, ONE of them safetyCritical --------------------

  const plans = maintenanceOf(entry);
  assert(
    plans.length === 4,
    `plan §5.7 authors 4 compressor plans; the entry carries ${plans.length}`,
  );
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 1 &&
      safetyCritical[0]?.category === "safety_critical" &&
      safetyCritical[0]?.priority === "critical" &&
      /relief valve/i.test(String(safetyCritical[0]?.title)),
    `${COMPRESSOR_CODE} must carry exactly ONE safetyCritical plan — the pressure-relief valve ` +
      "test, the first of the three ADR 0053 decision 8 names for this pack (the other two are " +
      "the AHU's fire-trip interlock test and the boiler's low-water cut-off and safety-valve " +
      "test). A receiver and a compressor element are pressure vessels, and the relief valve is " +
      "the last barrier if the controller's own pressure control fails; it is category " +
      `safety_critical at priority critical for that reason. Got ${safetyCritical.length}: ` +
      `${safetyCritical.map((plan) => plan.title).join("; ") || "(none)"}`,
  );
  // NO condition_based plan on this entry, and that is the correct authoring:
  // two of the four are runtime_based in `runtime` mode, keyed on the hour
  // counters the controller reports, which is how compressor service is actually
  // scheduled. A runtime plan is not a condition plan wearing another name — it
  // generates on accumulated hours, not on a measured value crossing a band.
  const conditionPlans = plans.filter((plan) => plan.category === "condition_based");
  const runtimePlans = plans.filter((plan) => plan.category === "runtime_based");
  assert(
    conditionPlans.length === 0 &&
      runtimePlans.length === 2 &&
      runtimePlans.every((plan) => plan.generationMode === "runtime"),
    `${COMPRESSOR_CODE} must carry NO condition_based plan and TWO runtime_based plans, both ` +
      'generated in "runtime" mode — the filter and separator service and the oil change, which ' +
      "is how a screw compressor's schedule is actually kept: on the controller's hour counters, " +
      "not on a measured value crossing a band. A runtime_based plan on a calendar mode is a " +
      `calendar plan wearing the wrong category. Got ${conditionPlans.length} condition_based ` +
      `and ${runtimePlans.length} runtime_based, modes [` +
      `${runtimePlans.map((plan) => String(plan.generationMode)).join(", ")}].`,
  );
  const serviceHours = String(
    runtimePlans.find((plan) => /filter/i.test(String(plan.title)))?.triggerSummary ?? "",
  );
  for (const pointKey of ["run_hours_h", "service_due_h"]) {
    assert(
      serviceHours.includes(pointKey),
      `${COMPRESSOR_CODE}'s filter-and-separator service plan must name ${pointKey} in its ` +
        "triggerSummary — the two counters it is keyed on, and the second of them is what the " +
        `service_due alarm binds. Got: "${serviceHours}"`,
    );
  }
  assertMaintenanceBounds(COMPRESSOR_CODE, entry);
  assertProvenance(COMPRESSOR_CODE, entry, MECHANICAL_TAG_LIST, "§3");
}

// ===========================================================================
// §4 — `hvac-chiller`
// ===========================================================================

const CHILLER_CODE = "hvac-chiller";

/**
 * §4's 25 table rows in the document's own order (`sortOrder` 0-24), then the
 * five authored derived codes at 25-29 — `[pointKey, tier, unit]`.
 *
 * **The derived rows are in the DOCUMENT's order of interest, not the formula
 * table's**: `cooling_load_tr`, `kw_per_tr` and `cop` are §4's *"Derived (the N4
 * KPIs)"* line in the order it names them, and the two ΔTs follow. Plan §5.4's
 * point table and `HVAC_CLASS_POINT_KEYS` both spell this order;
 * `assertPointTable` compares index by index and pins `sortOrder === index`, so
 * a reader diffing this file against §5.4 row for row must find them here.
 *
 * **Ten of the twenty-five rows are reused codes** — `chw_supply_temp_c`,
 * `chw_return_temp_c`, `chw_flow_lps`, `compressor_ok`, `cooling_kw`,
 * `kwh_total`, `oil_pressure_bar`, `oil_temp_c`, `run_hours_h`, `start_count` —
 * the most of any entry in the pack, referenced here and **redeclared nowhere**
 * (ADR 0053 decision 3). Five of them are `HVAC_POINT_KEYS` codes the seeded
 * `BASELINE-HVAC` template and the CRAC screens already consume, which is
 * exactly why the pack's new HVAC codes went into a SEPARATE array:
 * `hvacPointKeySchema` is a closed `z.enum` over the nine, and widening it would
 * have reached the CRAC pages.
 *
 * `refrigerant_charge_pct` is the entry's one **`M` row** — a charge level read
 * off a sight glass or a service gauge and written on a sheet — so it carries a
 * null `sourceDataKeyPattern` forever and never gets an `asset_points` row.
 *
 * **`chiller_fault_code` is tier X**, where the VFD's equivalent row is tier C.
 * That is the document's own split and is not to be normalised: a chiller
 * controller carries its own alarm text on the panel, and a drive does not.
 *
 * `cop` carries `null`: a coefficient of performance is dimensionless, which ADR
 * 0051 Amendment 6 decision 4 spells `""` in the vocabulary, and a template
 * `unit` of `null` defers to the catalog rather than overriding it. The three
 * `0/1` and `code` rows and `start_count` carry `null` for the same reason.
 */
const CHILLER_POINTS: readonly PointRow[] = [
  ["chiller_status", "core", null],
  ["chiller_alarm", "core", null],
  ["chiller_fault_code", "extended", null],
  ["chw_supply_temp_c", "core", "°C"],
  ["chw_return_temp_c", "core", "°C"],
  ["chw_setpoint_c", "core", "°C"],
  ["chw_flow_lps", "core", "L/s"],
  ["cw_entering_temp_c", "core", "°C"],
  ["cw_leaving_temp_c", "core", "°C"],
  ["cw_flow_lps", "extended", "L/s"],
  ["evap_pressure_bar", "extended", "bar"],
  ["cond_pressure_bar", "extended", "bar"],
  ["evap_approach_c", "extended", "°C"],
  ["cond_approach_c", "extended", "°C"],
  ["compressor_ok", "core", null],
  ["compressor_load_pct", "core", "%"],
  ["compressor_current_a", "core", "A"],
  ["cooling_kw", "core", "kW"],
  ["kwh_total", "extended", "kWh"],
  ["oil_pressure_bar", "extended", "bar"],
  ["oil_temp_c", "extended", "°C"],
  ["discharge_temp_c", "extended", "°C"],
  ["run_hours_h", "core", "h"],
  ["start_count", "extended", null],
  ["refrigerant_charge_pct", "manual", "%"],
  ["cooling_load_tr", "derived", "TR"],
  ["kw_per_tr", "derived", "kW/TR"],
  ["cop", "derived", null],
  ["chw_delta_t_c", "derived", "°C"],
  ["cw_delta_t_c", "derived", "°C"],
];

/**
 * §4's five expressible derived codes — **the N4 form's KPIs** — as literal
 * strings (plan §5.0). Every input is tier C, so all five compute on every
 * chiller the template is imported onto.
 *
 * **`4.19` and `3.517` ARE THE DOCUMENT'S OWN CONSTANTS**, written in §4's
 * *Derived:* line: 4.19 kJ/kg·K is the specific heat of water and 3.517 kW is
 * one ton of refrigeration. They are physics, not site values, so B7 — which
 * governs alarm thresholds — has nothing to say about them, and they are the
 * only numbers in this entry outside a `sortOrder`.
 *
 * **`kw_per_tr` AND `cop` RESTATE THE ΔT RATHER THAN REFERENCING
 * `chw_delta_t_c`.** A derived point may reference only MEASURED points of the
 * same entry (ADR 0036 decision 7, enforced by `validateFormula`), so a formula
 * naming another derived point does not parse. The restatement is therefore
 * required, not clumsy, and it must not be "simplified" into a reference. The
 * literal comparison below is what makes that permanent: two valid formulas over
 * the same inputs can mean opposite things — `{return} - {supply}` and
 * `{supply} - {return}` are a load and its negative — and a rewrite of a shipped
 * formula is a silent behaviour change on every organization that imported the
 * entry.
 *
 * Division by zero needs no guard: `evaluate.ts` returns `non_finite`, so
 * `kw_per_tr` at zero ΔT and `cop` on a chiller that is off — `cooling_kw` zero —
 * yield no value for that reading rather than a fabricated one. **None of the
 * five overrides `maxInputAgeSeconds`**: a BTU meter and a power meter both
 * report inside the 300 s default, so all five are `null` and there is no
 * `approach_c`-shaped override anywhere in this pack.
 */
const CHILLER_DERIVED: readonly DerivedRow[] = [
  ["chw_delta_t_c", "{chw_return_temp_c} - {chw_supply_temp_c}", null],
  ["cw_delta_t_c", "{cw_leaving_temp_c} - {cw_entering_temp_c}", null],
  [
    "cooling_load_tr",
    "{chw_flow_lps} * ({chw_return_temp_c} - {chw_supply_temp_c}) * 4.19 / 3.517",
    null,
  ],
  [
    "kw_per_tr",
    "{cooling_kw} * 3.517 / ({chw_flow_lps} * ({chw_return_temp_c} - {chw_supply_temp_c}) * 4.19)",
    null,
  ],
  [
    "cop",
    "{chw_flow_lps} * ({chw_return_temp_c} - {chw_supply_temp_c}) * 4.19 / {cooling_kw}",
    null,
  ],
];

/**
 * §4's nine alarm bullets become **nine** rows — one per bullet, as the
 * compressor's did.
 *
 * **Two are `energy` and seven are `operations`** (plan §12 ruling 6).
 * `cond_approach_high` and `kw_per_tr_high` are both about a machine that still
 * makes its chilled water and spends more doing it, which is a continuous cost
 * rather than an event; the other seven stop, threaten or degrade the duty.
 * **`chw_leaving_temp_high` is `operations` and NOT `comfort`** — the AHU's
 * three comfort rows serve occupants, and a chiller serves a loop whose load is
 * unknown to it.
 *
 * `kw_per_tr_high` **binds the derived point `kw_per_tr`** — the N5 health
 * signal, authored here as a point with an alarm on it rather than as
 * `content.health`, which is ADR 0050's surface (ADR 0053 decision 11).
 */
const CHILLER_ALARMS: readonly AlarmRow[] = [
  ["chiller_alarm", "chiller_alarm", "critical", "operations"],
  ["chw_leaving_temp_high", "chw_supply_temp_c", "warning", "operations"],
  ["chw_flow_low", "chw_flow_lps", "critical", "operations"],
  ["cond_pressure_high", "cond_pressure_bar", "critical", "operations"],
  ["evap_pressure_low", "evap_pressure_bar", "critical", "operations"],
  ["cond_approach_high", "cond_approach_c", "warning", "energy"],
  ["kw_per_tr_high", "kw_per_tr", "warning", "energy"],
  ["oil_pressure_low", "oil_pressure_bar", "critical", "operations"],
  ["compressor_short_cycling", "start_count", "warning", "operations"],
];

/**
 * `hvac-chiller` against `docs/e5.2-derived-taglist-v1.md` §4 (plan §5.4) — **the
 * first stock entry ever filed under `hvac`**, and the entry plan §3's second
 * escalation checkpoint keys on.
 *
 * It exercises more at once than any other entry in the pack: a `domain` other
 * than the code's own pack name, five formulas including the two that carry
 * physical constants and the two that restate a ΔT inside a denominator, an
 * alarm bound to a derived point, ten reused codes, and the pack's third `M`
 * row.
 */
function checkChiller(): void {
  const entry = requireStockEntry(CHILLER_CODE);
  assertEntryIdentity(CHILLER_CODE, entry, "chiller", "hvac");

  // ---- 30 points, 13 core + 11 extended + 1 manual + 5 derived ------------

  assert(
    tierCount(entry, "core") === 13 &&
      tierCount(entry, "extended") === 11 &&
      tierCount(entry, "manual") === 1 &&
      tierCount(entry, "derived") === 5,
    `§4 marks 13 rows C, 11 X and 1 M, and five of its seven derived codes are authored — ` +
      `13/11/1/5. Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(CHILLER_CODE, "§4", entry, CHILLER_POINTS);
  assertDerivedPoints(CHILLER_CODE, entry, CHILLER_DERIVED);
  assertNoKpis(CHILLER_CODE, entry, "§4");
  assertDeferralsAbsent(CHILLER_CODE, entry);

  // ---- the two ΔTs are RESTATED inside kw_per_tr and cop ------------------

  for (const pointKey of ["kw_per_tr", "cop"]) {
    const formula = String(
      entry.points.find((point) => point.pointKey === pointKey)?.formula ?? "",
    );
    assert(
      !formula.includes("{chw_delta_t_c}") &&
        formula.includes("{chw_return_temp_c} - {chw_supply_temp_c}"),
      `${CHILLER_CODE}.${pointKey} must restate the chilled-water ΔT from its two MEASURED ` +
        "temperatures and must not reference the derived point chw_delta_t_c. A derived point may " +
        "reference only measured points of the same entry (ADR 0036 decision 7, enforced by " +
        "validateFormula), so the reference form does not parse at all — the restatement is " +
        "required rather than clumsy, and a later author \"simplifying\" it breaks the entry for " +
        `every organization that imported it. Got: "${formula}"`,
    );
  }

  // ---- the one M row ------------------------------------------------------

  const charge = entry.points.find((point) => point.pointKey === "refrigerant_charge_pct");
  assert(
    charge?.meta?.tier === "manual" &&
      charge.required === false &&
      charge.sourceDataKeyPattern === null,
    `${CHILLER_CODE}.refrigerant_charge_pct must be the entry's one M row — tier manual, ` +
      "optional, with a null sourceDataKeyPattern. §4 marks it \"manual / service\": a charge " +
      "level is read off a sight glass or a service gauge with the machine down and written on a " +
      "sheet, so it carries a null pattern FOREVER, always lands in skippedPoints and never gets " +
      "an asset_points row until F1.8 manual entry gives it somewhere to write. The " +
      "refrigerant-charge plan on this template is what produces the value in the meantime. Got " +
      `tier ${String(charge?.meta?.tier)}, required ${String(charge?.required)}, pattern ` +
      `${String(charge?.sourceDataKeyPattern)}.`,
  );

  // ---- 9 alarms, two of them energy and one bound to a derived point ------

  const alarms = alarmsOf(entry);
  assertAlarmTable(CHILLER_CODE, "§4", alarms, CHILLER_ALARMS);
  assertPhilosophyRows(CHILLER_CODE, alarms);
  assertSkillAssignment(
    CHILLER_CODE,
    alarms,
    {
      chiller_alarm: "hvac",
      chw_leaving_temp_high: "hvac",
      chw_flow_low: "hvac",
      cond_pressure_high: "hvac",
      evap_pressure_low: "hvac",
      cond_approach_high: "hvac",
      kw_per_tr_high: "hvac",
      oil_pressure_low: "hvac",
      // The one row that is not the refrigeration trade's: starts accumulating
      // faster than rated is a control question — a setpoint dead band, a
      // staging sequence, a loop hunting — and the machine itself is healthy.
      compressor_short_cycling: "controls",
    },
    // No process-chemistry row on a chiller: all four of the pack's no-skill
    // rows are the boiler's. The empty list is a claim, not a gap.
    [],
  );

  const kwPerTr = entry.points.find((point) => point.pointKey === "kw_per_tr");
  const kwPerTrHigh = alarms.find((alarm) => alarm.code === "kw_per_tr_high");
  assert(
    kwPerTrHigh?.pointKey === "kw_per_tr" && kwPerTr?.kind === "derived",
    `${CHILLER_CODE}'s kw_per_tr_high alarm must bind the DERIVED point kw_per_tr — the N5 health ` +
      "signal the 2026-08-22 sheet names, authored here as a computed point with an alarm on it. " +
      "That is the whole reason kw_per_tr is a promoted vocabulary code rather than a " +
      "content.kpis entry: assertContentRefsResolve lets an alarm bind any declared point, and a " +
      "KPI could not be bound at all. The baseline it is high AGAINST is a commissioning value " +
      "set per site, and chiller-health analytics over it is ADR 0050's surface and not this " +
      `row's (ADR 0053 decision 11). Got "${String(kwPerTrHigh?.pointKey)}" on a ` +
      `"${String(kwPerTr?.kind)}" point.`,
  );

  const shortCycling = alarms.find((alarm) => alarm.code === "compressor_short_cycling");
  const startCount = entry.points.find((point) => point.pointKey === "start_count");
  assert(
    shortCycling?.pointKey === "start_count" && startCount?.kind === "measured",
    `${CHILLER_CODE}'s compressor_short_cycling alarm must bind the CUMULATIVE COUNTER ` +
      "start_count, exactly as the pump's short_cycling row does. §4's bullet is \"compressor " +
      "starts-per-hour high\" and a per-hour rate is not expressible — bms-calc-v1 has " +
      "arithmetic and five functions and no state — so the alarm binds the counter and the RATE " +
      `is the rule's to evaluate (E2.4). Got "${String(shortCycling?.pointKey)}" on a ` +
      `"${String(startCount?.kind)}" point.`,
  );

  const energyRows = alarms
    .filter((alarm) => alarm.category === "energy")
    .map((alarm) => alarm.code);
  assert(
    energyRows.join(",") === "cond_approach_high,kw_per_tr_high",
    `${CHILLER_CODE} must file exactly cond_approach_high and kw_per_tr_high as "energy" and the ` +
      "other seven as \"operations\" (plan §12 ruling 6). Both energy rows are about a machine " +
      "that still makes its chilled water and spends more doing it — a continuous cost rather " +
      "than an event — while the other seven stop, threaten or degrade the duty. " +
      "chw_leaving_temp_high in particular is operations and NOT comfort: the AHU's three comfort " +
      `rows serve occupants, and a chiller serves a loop whose load is unknown to it. Got ` +
      `[${energyRows.join(", ")}].`,
  );

  // ---- 4 maintenance plans, none safetyCritical ---------------------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 4, `plan §5.7 authors 4 chiller plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 0,
    "no chiller plan is safetyCritical — ADR 0053 decision 8 names exactly three in the pack (the " +
      "compressor's relief-valve test, the AHU's fire-trip interlock test and the boiler's " +
      "low-water cut-off and safety-valve test), and none of them is here. A tube clean and a " +
      `leak check are reliability and compliance work, not a life-safety barrier. Got ` +
      `${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join("; ") || "(none)"}`,
  );
  const conditionPlans = plans.filter((plan) => plan.category === "condition_based");
  assert(
    conditionPlans.length === 1 && conditionPlans[0]?.generationMode === "condition",
    `${CHILLER_CODE} must carry exactly one condition_based plan, generated in "condition" mode ` +
      "— the condenser tube clean. A condition_based plan on a calendar mode is a calendar plan " +
      `wearing the wrong category. Got ${conditionPlans.length} plan(s), mode ` +
      `"${String(conditionPlans[0]?.generationMode)}".`,
  );
  const tubeClean = String(conditionPlans[0]?.triggerSummary ?? "");
  assert(
    tubeClean.includes("cond_approach_c"),
    `${CHILLER_CODE}'s condenser tube-clean plan must name cond_approach_c in its triggerSummary ` +
      "— the point whose rise IS the trigger, and the point cond_approach_high binds. A widening " +
      "condenser approach at a steady load is the direct measure of tube fouling, and it is what " +
      "turns this plan from a calendar clean into a clean that happens when the machine needs " +
      `one. Got: "${tubeClean}"`,
  );
  const calibration = plans.find((plan) => plan.category === "calibration");
  assert(
    calibration !== undefined,
    `${CHILLER_CODE} must carry a calibration plan — the sensor and flow-switch calibration, and ` +
      "the pack's first use of that category",
  );
  const calibrationTrigger = String(calibration?.triggerSummary ?? "");
  for (const pointKey of ["chw_supply_temp_c", "chw_return_temp_c", "chw_flow_lps", "cooling_kw"]) {
    assert(
      calibrationTrigger.includes(pointKey),
      `${CHILLER_CODE}'s calibration plan must name ${pointKey} in its triggerSummary — the four ` +
        "measured inputs of cooling_load_tr, kw_per_tr and cop. Those three points are COMPUTED, " +
        "so nothing about them looks wrong when an input has drifted: a flow meter reading high " +
        "produces a confident kW/TR that is simply false, and the kw_per_tr_high alarm then " +
        "either fires on nothing or stays quiet on a real degradation. This plan is what keeps a " +
        `computed KPI honest, and it is why it exists at all. Got: "${calibrationTrigger}"`,
    );
  }
  assertMaintenanceBounds(CHILLER_CODE, entry);
  assertProvenance(CHILLER_CODE, entry, MECHANICAL_TAG_LIST, "§4");
}

/**
 * Every per-class block in this file. Called by `mechanical-classes-2.test.ts`,
 * its name-sibling wrapper. **§6 and §7 live in `mechanical-classes-3.spec.ts`**
 * — two entries per file, so no file in this directory approaches the §4.5 cap.
 */
export function runMechanicalClassEntryTests2(): void {
  checkCompressor();
  checkChiller();
}
