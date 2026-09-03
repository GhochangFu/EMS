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

/**
 * Every per-class block in this file. Called by `mechanical-classes-2.test.ts`,
 * its name-sibling wrapper. **Task 9 appends `checkChiller()` below
 * `checkCompressor()` and changes nothing else in this file.**
 */
export function runMechanicalClassEntryTests2(): void {
  checkCompressor();
}
