import { FACILITY_STOCK_ASSET_TEMPLATES } from "./facility";
import { DEFERRED_DERIVED_CODES } from "./stock-catalog-deferrals.spec";
import { alarmsOf, assert, maintenanceOf, requireStockEntry } from "./stock-catalog.spec";
import { FACILITY_TAG_LIST } from "./facility-classes.spec";
import {
  assertAlarmTable,
  assertDeferralsAbsent,
  assertDerivedPoints,
  assertEntryIdentity,
  assertMaintenanceBounds,
  assertNoKpis,
  assertNoLimitNumbers,
  assertPhilosophyRows,
  assertPointTable,
  assertProvenance,
  assertSkillAssignment,
  philosophyOf,
  tierCount,
  type AlarmRow,
  type DerivedRow,
  type PointRow,
} from "./stock-transcription.spec";

/**
 * `E5.3` PR 2 pass C5 — §8b of `docs/e5.3-derived-taglist-v1.md`, the
 * escalator, and **the block that closes the pack**.
 *
 * **One entry per file, as `-4` set.** §1 and §2 are in
 * `facility-classes.spec.ts`, §3-§5 in `-2`, §6 and §7 in `-3`, §8a alone in
 * `-4`, and §8b alone here. `facility-classes-5.test.ts` is this file's
 * name-sibling wrapper — `tests/repo-invariants.test.ts` pairs a spec with a
 * wrapper of its own name, and a spec run from a differently-named one still
 * executes but is absent from coverage.
 *
 * **Three claims here are about the PACK and not about this entry**, and they
 * are here because this is the last entry commit and there is nowhere later to
 * put them: the two no-skill rows of PR 2, the sixteen of the whole pack (plan
 * §12 ruling 4), and the cross-entry pair — `availability_pct` and `mtbf_h`
 * deferred on **both** vertical-transport entries, with `controller_comms_ok`
 * declared once on `facility-access-door` in PR 1 and referenced by both.
 *
 * `refusalFrom` and the citation-override self-test live in
 * `facility-classes-4.spec.ts` with the lift. They are not repeated here: the
 * override is one mechanism and one entry proves it, and a second copy over the
 * escalator would assert the same line of `stock-catalog.spec.ts` twice.
 */

/**
 * The regime sentence `assertNoLimitNumbers` prints for an **escalator** row
 * caught carrying a digit — the fifth constant in this pack, and the last.
 *
 * `E5.3` §13 item 7's rule: the helper prints the sentence it is given, so a
 * failure on `missing_step` that cited NFPA 72 would send the reader to a
 * fire-alarm standard that says nothing about a step chain.
 * `FACILITY_LIFE_SAFETY_REGIME` is the fire panel's authority,
 * `FACILITY_OCCUPANCY_REGIME` the occupancy rows', `FACILITY_AIR_QUALITY_REGIME`
 * the air node's and `FACILITY_VERTICAL_TRANSPORT_REGIME` the lift's; this is
 * the escalator's, and `facility-classes-4.spec.ts` already says it is owed
 * here. The B7/B8 rule all five state is identical — v1 ships the meaning and
 * no number — and only the authority differs.
 *
 * It is safe for this string to carry the standard designations because it is
 * interpolated only into the FAILURE message. The rows themselves carry no
 * digit anywhere, which is why **neither "EN 115" nor "IS 4591" appears in an
 * alarm message or inside a `philosophy`** on the three rows below: the
 * designations contain digits, and the rule is a rule about the row.
 */
export const FACILITY_ESCALATOR_REGIME =
  "EN 115 and IS 4591 fix what an escalator's safety devices ARE — the comb-plate impact " +
  "switches, the skirt deflection switches, the handrail inlet guards, the step-chain tension " +
  "monitor, the missing-step detector and the auxiliary brake — and they fix the handrail band " +
  "as a tolerance around THAT machine's own step speed rather than as a number a template could " +
  "ship. A travelator, a three-metre rise in a shop and a twelve-metre rise in a metro station " +
  "are the same class here and are commissioned to different values, and the stopping distance " +
  "is set against the rated speed and the loaded direction. The statutory authority is the " +
  "state Lift Act licence, which names the inspection and not a limit.";

// ===========================================================================
// §8b — `mechanical-escalator`
// ===========================================================================

const ESCALATOR_CODE = "mechanical-escalator";
const LIFT_CODE = "mechanical-lift";
const ACCESS_DOOR_CODE = "facility-access-door";

/**
 * The two entries PR 2 ships, as a `const` tuple rather than an array literal.
 *
 * The literal type is load-bearing: `DEFERRED_DERIVED_CODES` is a `Record`
 * keyed by `StockEntryCode`, so a `string[]` loop variable is an implicit `any`
 * index and `tsc` refuses it under `noImplicitAny`. Widening the Record's key
 * to `string` would have compiled and would have let a misspelt entry code read
 * `undefined` at runtime, which is the failure this file is asserting the
 * absence of.
 */
const VERTICAL_TRANSPORT_CODES = [LIFT_CODE, ESCALATOR_CODE] as const;

/**
 * §8b's 39 **measured** rows in the document's own order (`sortOrder` 0-38),
 * then the two promoted codes at 39 and 40 — `[pointKey, tier, unit]`.
 *
 * **The document prints ONE flat table here, with no sub-blocks.** §8a is
 * grouped into service state, motion, doors, drive and machine, shaft, ride
 * quality, counters and manual rows; §8b is forty consecutive rows and nothing
 * else. The comments below are this file's own reading aids and are NOT a claim
 * that the handout carries headings — `E5.3` §13 item 6's lesson, where the
 * lift's spec had to record that the plan said six sub-blocks and the document
 * has eight.
 *
 * **The table has forty rows and thirty-nine of them are here.**
 * `handrail_speed_dev_pct` is the document's thirteenth row and is marked
 * `X/D`; plan §12 ruling 3 authors it **derived**, so it leaves the measured
 * sequence and is appended at `sortOrder` 39. Every row after it therefore sits
 * one index below its position on the handout, which is deliberate and is
 * exactly what `assertPointTable` pins: `sortOrder` is the order the stock
 * viewer lists a template's points in, and a gap or a repeat would reorder a
 * screen nobody would think to check.
 *
 * **THIRTEEN codes are REFERENCED, never redeclared** (ADR 0054 decision 3) —
 * the most of any entry in the pack. Ten of them are the lift's own §8a rows
 * (`brake_state`, `brake_temp_c`, `passenger_count`, `annual_inspection_due`,
 * `brake_test_result`) or the mechanical vocabulary `E5.2` seeded
 * (`motor_current_a`, `motor_temp_c`, `kw`, `kwh_total`, `run_hours_h`,
 * `start_count`, `vibration_mms`), and `controller_comms_ok` is §3's, declared
 * on `facility-access-door` in PR 1. Each carries the unit the vocabulary
 * already holds, because a template `unit` is an override and `UNIT_BY_KEY`'s
 * seed is `COALESCE(existing, excluded)`.
 */
const ESCALATOR_POINTS: readonly PointRow[] = [
  // Service, mode and fault — the five C rows are here and in the safety block,
  // and they are what a dry-contact interface alone gives a site.
  ["esc_status", "core", null],
  ["esc_direction", "extended", null],
  ["esc_mode", "core", null],
  ["esc_fault", "core", null],
  // The OEM's fault dictionary is carried in the alarm text, never enumerated.
  ["esc_fault_code", "extended", null],
  // Safety chain and the device that opened it.
  ["esc_emergency_stop", "core", null],
  ["safety_circuit_ok", "extended", null],
  ["safety_device_tripped", "extended", null],
  ["controller_comms_ok", "core", null],
  // Speeds — the three inputs the handrail deviation is computed from.
  ["step_speed_ms", "extended", "m/s"],
  ["handrail_speed_l_ms", "extended", "m/s"],
  ["handrail_speed_r_ms", "extended", "m/s"],
  // Drive, gearbox and brakes.
  ["motor_current_a", "extended", "A"],
  ["motor_temp_c", "extended", "°C"],
  ["gearbox_temp_c", "extended", "°C"],
  ["gearbox_oil_level_low", "extended", null],
  ["brake_state", "extended", null],
  ["brake_temp_c", "extended", "°C"],
  ["aux_brake_tripped", "extended", null],
  // Chains, steps and the guard switches EN 115 names.
  ["step_chain_tension_ok", "extended", null],
  ["drive_chain_ok", "extended", null],
  ["missing_step_state", "extended", null],
  ["comb_plate_state", "extended", null],
  ["skirt_switch_state", "extended", null],
  ["handrail_inlet_state", "extended", null],
  ["passenger_sensor_state", "extended", null],
  ["passenger_count", "extended", null],
  // Truss and machine space.
  ["machine_space_temp_c", "extended", "°C"],
  ["truss_water_state", "extended", null],
  ["lubrication_fault", "extended", null],
  ["vibration_mms", "extended", "mm/s"],
  // Energy and usage counters.
  ["kw", "extended", "kW"],
  ["kwh_total", "extended", "kWh"],
  ["run_hours_h", "extended", "h"],
  ["start_count", "extended", null],
  ["standby_hours_h", "extended", "h"],
  // Manual / statutory — three M rows.
  ["annual_inspection_due", "manual", null],
  ["step_chain_elongation_pct", "manual", "%"],
  ["brake_test_result", "manual", null],
  // Promoted, appended after the table (plan §5.0, §12 rulings 2 and 3).
  ["handrail_speed_dev_pct", "derived", "%"],
  ["kwh_per_run_hour", "derived", "kWh/h"],
];

/**
 * §8b's two promoted codes, as literal strings (plan §5.0).
 *
 * **`handrail_speed_dev_pct` is SIGNED and takes the SLOWER handrail**, and
 * both halves of that sentence are the reason the formula is asserted
 * literally. `min(...)` and not `max(abs(...))`: a negative value is a handrail
 * running behind the step, which is the direction a passenger's hand is dragged
 * backwards and their body twisted — the entrapment case EN 115 bands. Taking
 * an absolute value would score a handrail running FAST and one running SLOW as
 * the same fault, and the fast one is a nuisance while the slow one is an
 * injury. Taking the maximum of the two handrails would report the healthier
 * side of a machine with one worn drive.
 *
 * `kwh_per_run_hour` is a lifetime ratio over cumulative counters — `E5.2`'s
 * `load_factor_pct` shape — and its unit is `kWh/h` rather than `kW` (plan §12
 * ruling 7): dimensionally the two agree, and `kW` would hide that the quantity
 * is an average over the machine's whole life rather than a present demand.
 *
 * Division by zero is `non_finite` in `bms-calc-v1` and produces **no value**,
 * which is correct and must not be guarded: `step_speed_ms` reads zero on a
 * stopped escalator and `run_hours_h` reads zero on a freshly reset controller,
 * and a `clamp` would ship a fabricated deviation for a machine that is not
 * moving. Neither carries a `maxInputAgeSeconds` override — the pack's only two
 * are the IAQ node's, whose outdoor reference is a slow *"site or API"* input.
 */
const ESCALATOR_DERIVED: readonly DerivedRow[] = [
  [
    "handrail_speed_dev_pct",
    "(min({handrail_speed_l_ms}, {handrail_speed_r_ms}) - {step_speed_ms}) / {step_speed_ms} * 100",
    null,
  ],
  ["kwh_per_run_hour", "{kwh_total} / {run_hours_h}", null],
];

/**
 * §8b's thirteen alarm bullets become **fifteen** rows: *e-stop / safety device
 * tripped* and *motor / gearbox temperature high* are each one bullet over two
 * distinct declared points, and each splits.
 *
 * **`safety_device_tripped` is an alarm code AND a point code, and the alarm
 * binds neither the one you expect.** The alarm binds `safety_circuit_ok` — the
 * `0/1` flag that says the chain is open — while the `enum` row spelled the
 * same way carries WHICH device opened it and is named in the alarm text.
 * That is §5.0's vendor-code rule (`esc_fault_code`, `safety_device_tripped`
 * are `code`/`enum` rows and the alarms bind the flag beside them), and
 * binding the enum instead would typecheck, pass `checkEntry` and ship a rule
 * that fires on a device identifier.
 *
 * `handrail_speed_deviation_high` binds `handrail_speed_dev_pct` — **a DERIVED
 * point**, the second such binding in the pack after the lift's
 * `door_reversal_ratio_rising`, and the whole reason the `X/D` row was promoted
 * rather than deferred. `statutory_inspection_overdue` binds
 * `annual_inspection_due`, a **`manual`** row whose value arrives through
 * `F1.8` (plan §12 ruling 6).
 */
const ESCALATOR_ALARMS: readonly AlarmRow[] = [
  ["esc_out_of_service", "esc_status", "critical", "operations"],
  ["esc_fault", "esc_fault", "critical", "operations"],
  ["emergency_stop_pressed", "esc_emergency_stop", "warning", "safety"],
  ["safety_device_tripped", "safety_circuit_ok", "critical", "safety"],
  ["missing_step", "missing_step_state", "critical", "safety"],
  ["handrail_speed_deviation_high", "handrail_speed_dev_pct", "critical", "safety"],
  ["motor_temp_high", "motor_temp_c", "warning", "operations"],
  ["gearbox_temp_high", "gearbox_temp_c", "warning", "operations"],
  ["gearbox_oil_low", "gearbox_oil_level_low", "warning", "operations"],
  ["brake_fault", "aux_brake_tripped", "critical", "safety"],
  ["lubrication_fault", "lubrication_fault", "warning", "operations"],
  ["truss_water", "truss_water_state", "warning", "safety"],
  ["vibration_high", "vibration_mms", "warning", "operations"],
  ["controller_comms_loss", "controller_comms_ok", "critical", "operations"],
  ["statutory_inspection_overdue", "annual_inspection_due", "warning", "safety"],
];

/**
 * **`emergency_stop_pressed` is the ONE row on this entry that carries no
 * `skill`** — and with the lift's `fire_recall_active` it is the second and
 * last of PR 2, which makes the pack's sixteen (plan §12 ruling 4).
 *
 * The rule the fire panel set: a trade answers the machine's own
 * infrastructure; none of migration `0034`'s five trades answers the EVENT the
 * machine reports. A pressed emergency stop is a **person** — a passenger who
 * saw something, a shop assistant with a trolley wedged in the comb plate, a
 * child playing with a button at the newel. Nothing is broken and no engineer
 * is dispatched by the press itself: somebody goes and looks, and if there is
 * damage the row that reports it is `safety_device_tripped` or `missing_step`,
 * which do carry `mechanical`.
 *
 * `safety_device_tripped` and `missing_step` DO carry a trade, and that is the
 * distinction rather than an exception: a safety device that opened has to be
 * found, proved and reset by a competent person before the machine runs again.
 */
const ESCALATOR_NO_SKILL_ROWS = ["emergency_stop_pressed"] as const;

/**
 * `mechanical-escalator` against `docs/e5.3-derived-taglist-v1.md` §8b (plan
 * §5.9) — **the entry that closes the pack**, and the one that carries the
 * pack's only signed formula.
 */
function checkEscalator(): void {
  const entry = requireStockEntry(ESCALATOR_CODE);
  assertEntryIdentity(ESCALATOR_CODE, entry, "escalator", "mechanical");

  // ---- 41 points, 5 core + 31 extended + 3 manual + 2 derived -------------

  assert(
    tierCount(entry, "core") === 5 &&
      tierCount(entry, "extended") === 31 &&
      tierCount(entry, "manual") === 3 &&
      tierCount(entry, "derived") === 2,
    "§8b prints forty rows: 5 C, 3 M, one X/D and 31 plain X. The X/D row is authored derived " +
      "(plan §12 ruling 3), so 39 rows are measured and two derived codes are appended — " +
      `5/31/3 + 2. Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(ESCALATOR_CODE, "§8b", entry, ESCALATOR_POINTS);
  assertDerivedPoints(ESCALATOR_CODE, entry, ESCALATOR_DERIVED);
  assertNoKpis(ESCALATOR_CODE, entry, "§8b");
  assertDeferralsAbsent(ESCALATOR_CODE, entry);

  // ---- the X/D row, authored derived, and appended at 39 rather than 11 ----

  const deviation = entry.points.find((point) => point.pointKey === "handrail_speed_dev_pct");
  assert(
    deviation?.kind === "derived" &&
      deviation.sortOrder === 39 &&
      deviation.required === false &&
      deviation.meta === undefined,
    `${ESCALATOR_CODE}.handrail_speed_dev_pct must be DERIVED and sit at sortOrder 39, not at the ` +
      "document's row index 11 (plan §12 ruling 3). §8b marks it X/D and the deviation is " +
      "computable from three rows this entry declares, so it is promoted — and a derived point " +
      "is appended AFTER the measured table rather than left in the document's sequence, because " +
      "sortOrder is what the stock viewer lists points by and the measured rows must stay in the " +
      "handout's order for a client redlining it. It carries no meta.tier either: a tier says " +
      "whether a site's instrument reaches the row, and a computed value has no instrument " +
      `(E5.3 §13 item 9). Got kind ${String(deviation?.kind)}, sortOrder ` +
      `${String(deviation?.sortOrder)}, required ${String(deviation?.required)}, meta ` +
      `${JSON.stringify(deviation?.meta ?? null)}.`,
  );
  assert(
    deviation?.formula ===
      "(min({handrail_speed_l_ms}, {handrail_speed_r_ms}) - {step_speed_ms}) / {step_speed_ms} * 100",
    `${ESCALATOR_CODE}.handrail_speed_dev_pct's formula must take min() of the two handrails and ` +
      "must stay SIGNED. max(abs(...)) parses, evaluates and is wrong twice over: abs() scores a " +
      "handrail running fast the same as one running slow, and only the slow one drags a " +
      "passenger's hand behind their body, which is the entrapment direction the standard bands; " +
      "max() then reports the healthier of the two handrails on a machine with one worn drive. " +
      `Got "${String(deviation?.formula)}".`,
  );

  // ---- the thirteen referenced codes, each with the vocabulary's unit ------

  const referenced: Readonly<Record<string, string | null>> = {
    controller_comms_ok: null,
    motor_current_a: "A",
    motor_temp_c: "°C",
    brake_state: null,
    brake_temp_c: "°C",
    passenger_count: null,
    kw: "kW",
    kwh_total: "kWh",
    run_hours_h: "h",
    start_count: null,
    vibration_mms: "mm/s",
    annual_inspection_due: null,
    brake_test_result: null,
  };
  assert(
    Object.keys(referenced).length === 13,
    "§8b references thirteen codes it does not declare — the most of any entry in the pack " +
      `(ADR 0054 decision 9). This list holds ${Object.keys(referenced).length}.`,
  );
  for (const [pointKey, unit] of Object.entries(referenced)) {
    const point = entry.points.find((row) => row.pointKey === pointKey);
    assert(
      point !== undefined && (point.unit ?? null) === unit,
      `${ESCALATOR_CODE}.${pointKey} is a REFERENCED code — declared by the lift, by an earlier ` +
        "entry or by the mechanical vocabulary E5.2 seeded, and redeclared nowhere (ADR 0054 " +
        `decision 3). It must carry the unit the vocabulary already holds (${String(unit)}), ` +
        "because a template unit OVERRIDES the catalog's on every instantiated point and " +
        "UNIT_BY_KEY's seed is COALESCE(existing, excluded), so a wrong one here cannot be " +
        `corrected by a later seed. Got ${String(point?.unit)}.`,
    );
  }

  // ---- the three M rows ---------------------------------------------------

  const manualRows = entry.points.filter((point) => point.meta?.tier === "manual");
  assert(
    manualRows.every((point) => point.required === false && point.sourceDataKeyPattern === null) &&
      manualRows.map((point) => point.pointKey).join(",") ===
        "annual_inspection_due,step_chain_elongation_pct,brake_test_result",
    `${ESCALATOR_CODE}'s three M rows are the statutory block: the inspection due date, the ` +
      "chain-stretch measurement a fitter takes with a gauge, and the brake stopping-distance " +
      "test result. Each must be optional with a null sourceDataKeyPattern — an M row is always " +
      "in skippedPoints and never gets an asset_points row, so promoting one to C would make " +
      `every instantiation fail. Got [${manualRows.map((point) => point.pointKey).join(", ")}].`,
  );

  // ---- 15 alarms from thirteen bullets, one of them with no trade ---------

  const alarms = alarmsOf(entry);
  assertAlarmTable(ESCALATOR_CODE, "§8b", alarms, ESCALATOR_ALARMS);
  assertPhilosophyRows(ESCALATOR_CODE, alarms);
  assertSkillAssignment(
    ESCALATOR_CODE,
    alarms,
    {
      esc_out_of_service: "mechanical",
      esc_fault: "mechanical",
      safety_device_tripped: "mechanical",
      missing_step: "mechanical",
      handrail_speed_deviation_high: "mechanical",
      motor_temp_high: "electrical",
      gearbox_temp_high: "mechanical",
      gearbox_oil_low: "mechanical",
      brake_fault: "mechanical",
      lubrication_fault: "mechanical",
      truss_water: "civil",
      vibration_high: "mechanical",
      controller_comms_loss: "controls",
      statutory_inspection_overdue: "mechanical",
    },
    ESCALATOR_NO_SKILL_ROWS,
  );
  assertNoLimitNumbers(
    ESCALATOR_CODE,
    alarms,
    ["handrail_speed_deviation_high", "missing_step", "safety_device_tripped"],
    FACILITY_ESCALATOR_REGIME,
  );

  // ---- the derived binding, and the enum the alarm does NOT bind ----------

  const deviationAlarm = alarms.find((alarm) => alarm.code === "handrail_speed_deviation_high");
  assert(
    deviationAlarm?.pointKey === "handrail_speed_dev_pct" && deviation?.kind === "derived",
    `${ESCALATOR_CODE}'s handrail_speed_deviation_high must bind handrail_speed_dev_pct, and that ` +
      "point must be DERIVED. This is the reason the X/D row was promoted rather than deferred: " +
      "the deviation is the quantity the standard bands, and no single measured row carries it — " +
      "an alarm on handrail_speed_l_ms alone would fire on a machine running slow on purpose in " +
      "energy-save. assertContentRefsResolve accepts it because a derived point is still a " +
      `declared template point. Got "${String(deviationAlarm?.pointKey)}" binding a ` +
      `${String(deviation?.kind)} point.`,
  );
  const chainAlarm = alarms.find((alarm) => alarm.code === "safety_device_tripped");
  const deviceRow = entry.points.find((point) => point.pointKey === "safety_device_tripped");
  assert(
    chainAlarm?.pointKey === "safety_circuit_ok" &&
      deviceRow?.kind === "measured" &&
      String(chainAlarm?.message ?? "").includes("safety_device_tripped"),
    `${ESCALATOR_CODE}'s safety_device_tripped ALARM must bind safety_circuit_ok — the flag that ` +
      "says the chain is open — and NOT the identically spelled enum POINT, which carries " +
      "which device opened it and is named in the alarm text instead. §5.0's rule: a vendor code " +
      "is carried in words, never enumerated, and the alarm binds the flag beside it. Binding " +
      "the enum would typecheck and pass checkEntry, and would ship a rule that fires on a " +
      `device identifier. Got "${String(chainAlarm?.pointKey)}".`,
  );
  const inspectionAlarm = alarms.find((alarm) => alarm.code === "statutory_inspection_overdue");
  const inspectionRow = entry.points.find((point) => point.pointKey === "annual_inspection_due");
  assert(
    inspectionAlarm?.pointKey === "annual_inspection_due" &&
      inspectionRow?.meta?.tier === "manual",
    `${ESCALATOR_CODE}'s statutory_inspection_overdue must bind annual_inspection_due at tier M — ` +
      "the pack's second alarm on a manual row, after the lift's (plan §12 ruling 6: author it, " +
      "do not drop it). The date arrives through F1.8 manual entry and never from a data key, " +
      `and nothing fires before E2.4 in any case. Got "${String(inspectionAlarm?.pointKey)}" ` +
      `binding a tier ${String(inspectionRow?.meta?.tier)} row.`,
  );

  // ---- 5 maintenance plans, three of them safetyCritical ------------------

  const plans = maintenanceOf(entry);
  assert(
    plans.length === 5,
    `plan §5.10 authors 5 escalator plans; the entry carries ${plans.length}`,
  );
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 3 &&
      safetyCritical.every((plan) => plan.category === "safety_critical") &&
      safetyCritical.map((plan) => plan.title).join(" | ") ===
        "Comb-plate, skirt and handrail-inlet safety-switch check | " +
          "Step-chain tension and elongation measurement | " +
          "Safety-circuit and brake stopping-distance test",
    "exactly three escalator plans are safetyCritical, all three also categorised " +
      "safety_critical — the comb-plate, skirt and handrail-inlet switch check, the step-chain " +
      "tension and elongation measurement, and the safety-circuit and brake stopping-distance " +
      "test. Those are the three barriers between a passenger and the moving machine: the " +
      "switches that stop it when something is caught, the chain whose failure drops the steps, " +
      "and the brake that has to hold a loaded descent. The statutory inspection is compliance " +
      "and the lubrication service is preventive, and neither is a barrier. Got " +
      `${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join(" | ") || "(none)"}`,
  );
  const statutory = plans.find((plan) => plan.title === "Annual statutory inspection");
  assert(
    statutory?.category === "compliance" && statutory.safetyCritical === false,
    `${ESCALATOR_CODE}'s annual statutory inspection is CATEGORY compliance and NOT ` +
      "safetyCritical, which is the boiler's IBR shape and is plan §12 ruling 6's explicit split: " +
      "decision 8 names the LIFT's inspection critical — a lift is a suspended car over a shaft " +
      "and its licence is what makes it legal to carry a passenger — and names the ESCALATOR's " +
      "three physical checks instead, because an escalator that fails stops being a staircase " +
      "rather than falling. The inspection is still mandatory and is still tracked; " +
      `safetyCritical is about the failure mode, not about the obligation. Got category ` +
      `"${String(statutory?.category)}", safetyCritical ${String(statutory?.safetyCritical)}.`,
  );
  const conditionPlans = plans.filter((plan) => plan.category === "condition_based");
  assert(
    conditionPlans.length === 0 && plans.every((plan) => plan.generationMode === "calendar"),
    `${ESCALATOR_CODE} must carry NO condition_based plan and every plan in "calendar" mode — the ` +
      "absence is asserted rather than left unsaid (E5.2 §13 item 10). An escalator runs one " +
      "duty cycle: it starts in the morning and stops at night, and start_count and run_hours_h " +
      "move at the same rate on a busy machine and a quiet one in the same building. There is no " +
      "wear counter here of the door operator's kind, so every interval is fixed by the standard " +
      `or by the statute. Got ${conditionPlans.length} condition_based plan(s), modes [` +
      `${plans.map((plan) => String(plan.generationMode)).join(", ")}].`,
  );
  const lubrication = plans.find(
    (plan) => plan.title === "Drive lubrication and gearbox oil service",
  );
  const lubricationTrigger = String(lubrication?.triggerSummary ?? "");
  for (const pointKey of ["gearbox_oil_level_low", "lubrication_fault"]) {
    assert(
      lubricationTrigger.includes(pointKey),
      `${ESCALATOR_CODE}'s lubrication plan must name ${pointKey} in its triggerSummary — the two ` +
        "rows that report the condition it exists to prevent, and the two whose alarms a " +
        "technician reads on arrival. A calendar plan that names the rows it services is what " +
        `lets a reader connect the round to the telemetry. Got: "${lubricationTrigger}"`,
    );
  }
  assertMaintenanceBounds(ESCALATOR_CODE, entry);
  assertProvenance(ESCALATOR_CODE, entry, FACILITY_TAG_LIST, "§8b");

  // ---- the six deferrals --------------------------------------------------

  assert(
    DEFERRED_DERIVED_CODES[ESCALATOR_CODE].length === 6,
    "§8b's Derived: line names eight codes; two are promoted and six are deferred — four " +
      "windows (availability_pct, mtbf_h, starts_per_day, safety_trips_per_month), one whose " +
      "denominator the document never fixes (standby_ratio_pct: standby over run, or over run " +
      "plus standby, and the two answers differ by the whole idle band) and one commissioning " +
      `baseline (motor_current_baseline_dev_pct). Got ${DEFERRED_DERIVED_CODES[ESCALATOR_CODE].length}.`,
  );
}

/**
 * **The cross-entry claim** — the one no single entry's block can make, and the
 * reason it lands with the last entry rather than the first.
 *
 * Two halves. `availability_pct` and `mtbf_h` are deferred on **both**
 * vertical-transport entries for the same reason and are named twice, which is
 * what a per-entry `DEFERRED_DERIVED_CODES` record exists to allow — a
 * catalog-wide list would have made one of the two records invisible.
 * `controller_comms_ok` is declared **once**, on `facility-access-door` in
 * PR 1, and referenced by both entries here: it is the dependency that made
 * PR 2 a branch cut from `main` after PR 1 merged rather than a stacked one,
 * and without PR 1's vocabulary commit the key is not an active `bms.point_keys`
 * row and every import of either entry fails.
 */
function assertTheCrossEntryClaims(): void {
  for (const code of ["availability_pct", "mtbf_h"]) {
    for (const entryCode of VERTICAL_TRANSPORT_CODES) {
      assert(
        DEFERRED_DERIVED_CODES[entryCode].includes(code),
        `${code} must be deferred on ${entryCode}. It is deferred on BOTH vertical-transport ` +
          "entries and for the same reason — availability is hours-in-state over a window and " +
          "mean time between failures needs the failure history rather than the current fault " +
          "flag, and bms-calc-v1 has neither a clock nor a memory. The record is per entry " +
          "precisely so that one code can be deferred on several classes and be NAMED on each; " +
          "a catalog-wide list would have hidden the second. Deferred on " +
          `${entryCode}: [${DEFERRED_DERIVED_CODES[entryCode].join(", ")}].`,
      );
    }
  }
  const door = requireStockEntry(ACCESS_DOOR_CODE);
  const declaringRow = door.points.find((point) => point.pointKey === "controller_comms_ok");
  assert(
    declaringRow !== undefined && door.domain === "facility",
    `controller_comms_ok must be declared on ${ACCESS_DOOR_CODE}, which is a facility entry — §3 ` +
      "is its first occurrence in the document and PR 1 filed it under the facility domain. Both " +
      "vertical-transport entries reference it and neither redeclares it, so a rename or a " +
      "deletion there silently breaks two mechanical entries in another pull request. Got " +
      `${declaringRow === undefined ? "no such point" : "the point"} on a ${door.domain} entry.`,
  );
  for (const entryCode of VERTICAL_TRANSPORT_CODES) {
    const referencing = requireStockEntry(entryCode);
    const row = referencing.points.find((point) => point.pointKey === "controller_comms_ok");
    assert(
      referencing.domain === "mechanical" && row?.meta?.tier === "core" && row.required === true,
      `${entryCode} must reference controller_comms_ok as a required core row while sitting in ` +
        "the mechanical domain. One code, declared on a facility entry and referenced by two " +
        "mechanical ones, is exactly the cross-domain reuse ADR 0054 decision 3 rules — the " +
        "gateway link is the same link whichever machine is behind it, and a second spelling " +
        `would have made two vocabularies of one fact. Got domain ${referencing.domain}, tier ` +
        `${String(row?.meta?.tier)}, required ${String(row?.required)}.`,
    );
  }
}

/**
 * **The pack's sixteen skill-less rows, counted over the whole index** — plan
 * §12 ruling 4's number, and the last commit is the only place it can be
 * asserted, because it is a statement about nine entries at once.
 *
 * Fourteen in PR 1 (the fire panel's seven, the access door's five, the
 * occupancy zone's one, the parking level's one) and **two in PR 2** — the
 * lift's `fire_recall_active` and the escalator's `emergency_stop_pressed`.
 * Both PR 2 rows are the same class: an event the machine reports, whose
 * responder is a person and not one of migration `0034`'s five trades.
 *
 * The count is read off `FACILITY_STOCK_ASSET_TEMPLATES` rather than off a list
 * of codes, so an author who quietly drops a `skill` from a row to make a
 * `assertSkillAssignment` map easier fails here. Ruling 4's alternative reading
 * — omit every fire and access row — would have given 22, and the difference is
 * exactly the six infrastructure rows a trade genuinely answers.
 */
function assertThePacksSkillLessRows(): void {
  const skillLess = FACILITY_STOCK_ASSET_TEMPLATES.flatMap((packEntry) =>
    alarmsOf(packEntry)
      .filter((alarm) => philosophyOf(alarm)?.skill === undefined)
      .map((alarm) => `${packEntry.code}.${alarm.code}`),
  );
  const inPr2 = skillLess.filter((row) => row.startsWith("mechanical-"));
  assert(
    skillLess.length === 16 && inPr2.length === 2,
    "the facility pack ships exactly SIXTEEN alarm rows with no philosophy.skill, two of them in " +
      "PR 2 (plan §12 ruling 4). A trade answers the machine's own infrastructure — the panel's " +
      "mains, the gateway link, the fire tank, the jockey pump, the controller's battery — and " +
      "none of migration 0034's five answers the EVENT the machine reports: a fire alarm, a " +
      "forced door, a zone over capacity, a lift under recall, an emergency stop somebody " +
      "pressed. Ruling 4's rejected reading omitted every fire and access row and would have " +
      `given 22. Got ${skillLess.length} (${inPr2.length} in PR 2): [${skillLess.join(", ")}].`,
  );
  assert(
    inPr2.join(",") ===
      "mechanical-lift.fire_recall_active,mechanical-escalator.emergency_stop_pressed",
    "PR 2's two skill-less rows must be exactly the lift's fire_recall_active and the " +
      "escalator's emergency_stop_pressed, in that order. A lift under Phase 1 recall has been " +
      "taken by the fire system and is behaving as designed; a pressed emergency stop is a " +
      "person who saw something. Neither is a machine fault and neither dispatches a trade, " +
      `while every other row on both entries is machine work. Got [${inPr2.join(", ")}].`,
  );
}

/**
 * Every per-class block in this file, and **the pack's last** — §8b, the two
 * cross-entry claims and the pack-wide skill-less count. Called by
 * `facility-classes-5.test.ts`, its name-sibling wrapper.
 */
export function runFacilityClassEntryTests5(): void {
  checkEscalator();
  assertTheCrossEntryClaims();
  assertThePacksSkillLessRows();
}
