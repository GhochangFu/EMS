import { DEFERRED_DERIVED_CODES } from "./stock-catalog-deferrals.spec";
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
 * `E5.2` pass C, the first of three transcription spec files — §1 (pump set)
 * and §2 (motor + VFD) of `docs/e5.2-derived-taglist-v1.md`.
 *
 * **Two entries per file, three files**, the cap `E5.1` measured at its own
 * first escalation checkpoint: `water-classes.spec.ts` reached 704 lines with
 * two entries in it, and the §4.5 pre-commit guard reads a whole file. §1 and
 * §2 here (plan Task 6 and Task 7), §3 and §4 in `mechanical-classes-2.spec.ts`
 * (Tasks 8 and 9), §6 and §7 in `-3` (Tasks 10 and 11). **This file is created
 * with the pump block alone and the VFD block appends to it** — the runner at
 * the foot is the seam, so Task 7 adds one `check…()` call and nothing else
 * moves.
 *
 * **Every helper is imported from `stock-transcription.spec.ts`, not restated.**
 * The `0034` skill parser, the point and alarm transcription tables, the
 * philosophy and skill assertions, the maintenance bounds, the deferral loop and
 * the provenance needles are properties of **every** stock pack — `E5.2` Task 2
 * moved them out of `water-classes.spec.ts` for exactly this file, because a
 * mechanical spec importing a water spec for `assertPointTable` would read as if
 * the mechanical pack were a water one. `assertEntryIdentity` and
 * `assertProvenance` take the domain and the tag list as parameters for the same
 * reason: this pack files four entries under `mechanical` and two under `hvac`,
 * and cites its own document.
 *
 * **`mechanical-classes.test.ts` is this file's name-sibling wrapper** —
 * `tests/repo-invariants.test.ts` matches the pair by name, and a spec imported
 * from a differently-named wrapper still runs but is absent from coverage.
 */

/** The document all six entries of this pack cite — ADR 0053 decision 7. */
export const MECHANICAL_TAG_LIST = "e5.2-derived-taglist-v1.md";

// ===========================================================================
// §1 — `mechanical-pump`
// ===========================================================================

const PUMP_CODE = "mechanical-pump";

/**
 * §1's 18 table rows in the document's own order (`sortOrder` 0-17), then the
 * two authored derived codes at 18-19 — `[pointKey, tier, unit]`.
 *
 * **Seven of the eighteen are reused codes** — `current_a`, `kw`, `kwh_total`,
 * `run_hours_h`, `start_count`, `winding_temp_c` and
 * `insulation_resistance_mohm` — referenced here and **redeclared nowhere**
 * (ADR 0053 decision 3). Their units are the ones the vocabulary already seeds
 * and are write-once through the seed's `COALESCE`, so the three that carry a
 * non-ASCII unit are the rows this table exists to hold: `°C` is **U+00B0**
 * DEGREE SIGN and `MΩ` is **U+03A9** GREEK CAPITAL LETTER OMEGA, matching
 * `UNIT_BY_KEY` byte for byte. A template `unit` is an override, so a
 * look-alike codepoint here would ship to every organization that imports the
 * entry and could not be corrected by a later seed.
 *
 * `start_count` carries `null`: the document's Unit column says *count*, which
 * ADR 0051 Amendment 6 decision 4 spells `""` in the vocabulary, and a template
 * `unit` of `null` defers to the catalog rather than overriding it. The four
 * `0/1` and `enum` rows carry `null` for the same reason.
 */
const PUMP_POINTS: readonly PointRow[] = [
  ["pump_status", "core", null],
  ["pump_mode", "core", null],
  ["pump_trip", "core", null],
  ["current_a", "core", "A"],
  ["kw", "extended", "kW"],
  ["kwh_total", "extended", "kWh"],
  ["suction_pressure_bar", "extended", "bar"],
  ["discharge_pressure_bar", "core", "bar"],
  ["flow_klh", "extended", "KL/hr"],
  ["run_hours_h", "core", "h"],
  ["start_count", "extended", null],
  ["de_bearing_temp_c", "extended", "°C"],
  ["nde_bearing_temp_c", "extended", "°C"],
  ["winding_temp_c", "extended", "°C"],
  ["vibration_mms", "extended", "mm/s"],
  ["seal_leak_state", "extended", null],
  ["dry_run_state", "extended", null],
  ["insulation_resistance_mohm", "manual", "MΩ"],
  ["head_m", "derived", "m"],
  ["specific_energy_kwh_kl", "derived", "kWh/KL"],
];

/**
 * §1's two expressible derived codes, as literal strings (plan §5.0).
 *
 * `10.2` is the document's own metres-of-water-per-bar constant, not the plan's,
 * and it is not a limit — B7 governs alarm thresholds, not physics. Both
 * formulas take their inputs from the same starter panel and instrument set at
 * the same scan rate, so both keep the 300 s default `maxInputAgeSeconds`,
 * spelled `null`. **There is no `approach_c`-shaped override anywhere in this
 * pack**, so a "helpful" one is a failure here with a reason.
 *
 * Division by zero needs no guard: `evaluate.ts` returns `non_finite`, so
 * `specific_energy_kwh_kl` at zero flow yields no value for that reading rather
 * than a fabricated one.
 */
const PUMP_DERIVED: readonly DerivedRow[] = [
  ["head_m", "({discharge_pressure_bar} - {suction_pressure_bar}) * 10.2", null],
  ["specific_energy_kwh_kl", "{kw} / {flow_klh}", null],
];

/**
 * §1's eight alarm bullets become **ten** rows. *"current high (overload /
 * blocked) or low (dry run / broken coupling)"* splits into two — two opposite
 * causes answered by two different trades — and *"bearing temperature high"*
 * splits into two because the entry declares a drive-end and a non-drive-end
 * bearing, and a reader has to know which end is hot.
 */
const PUMP_ALARMS: readonly AlarmRow[] = [
  ["pump_trip", "pump_trip", "critical", "operations"],
  ["current_high", "current_a", "warning", "operations"],
  ["current_low", "current_a", "warning", "operations"],
  ["discharge_pressure_low", "discharge_pressure_bar", "critical", "operations"],
  ["de_bearing_temp_high", "de_bearing_temp_c", "warning", "operations"],
  ["nde_bearing_temp_high", "nde_bearing_temp_c", "warning", "operations"],
  ["vibration_high", "vibration_mms", "warning", "operations"],
  ["seal_leak", "seal_leak_state", "warning", "operations"],
  ["service_due", "run_hours_h", "info", "operations"],
  ["short_cycling", "start_count", "warning", "operations"],
];

/**
 * **One code, three entries, one authoring** — the `load_pct` shape, and the
 * reason `DEFERRED_DERIVED_CODES` is a per-entry `Record` rather than one flat
 * list.
 *
 * `specific_energy_kwh_kl` means *energy per kilolitre moved* (ADR 0051
 * Amendment 6 decision 5: one code, one meaning). It is **deferred** on
 * `electrical-feeder`, which would need a KL throughput from another asset, and
 * on `water-ro`, whose §2 declares the HP pump's current rather than its kW —
 * and it is **authored** here, because the pump declares both `kw` and
 * `flow_klh`. Neither deferral becomes wrong because a pump can compute it, so
 * both records stay; a filing domain is not an exclusivity (decision 3).
 *
 * Asserted from the pump's block because the pump is where the authoring
 * happens: a later author deleting either deferral record to "tidy up" the
 * duplicate breaks this line, and a later author adding the code to the pump's
 * own deferral list breaks `assertDeferralsAbsent` beside it.
 */
function assertSpecificEnergyIsOneCodeThreeEntries(entry = requireStockEntry(PUMP_CODE)): void {
  const authored = entry.points.find((point) => point.pointKey === "specific_energy_kwh_kl");
  assert(
    authored?.kind === "derived",
    `${PUMP_CODE} must AUTHOR specific_energy_kwh_kl as a derived point — it declares both kw and ` +
      `flow_klh, which is exactly what the feeder and the RO lack. Got kind ` +
      `"${String(authored?.kind)}".`,
  );
  for (const other of ["electrical-feeder", "water-ro"] as const) {
    assert(
      DEFERRED_DERIVED_CODES[other].includes("specific_energy_kwh_kl"),
      `specific_energy_kwh_kl must stay on ${other}'s deferral list even though mechanical-pump ` +
        "authors it. The two records are claims about the feeder (which needs a KL throughput " +
        "from another asset) and the RO (whose section declares pump current, not kW), and " +
        "neither becomes authorable because a pump can compute the same meaning. This is the " +
        "load_pct shape — deferred on three electrical classes and a measured core point on the " +
        "UPS — and it is why a catalog-wide \"no entry declares a deferred code\" check would " +
        "fail on correct entries.",
    );
  }
}

/**
 * `mechanical-pump` against `docs/e5.2-derived-taglist-v1.md` §1 (plan §5.1) —
 * **the base class the document says every other pack's pump is**, and the entry
 * plan §3's first escalation checkpoint keys on. Unlike `E5.1`, whose first
 * entry had no derived point, this one exercises the derived machinery at once:
 * a formula over an `X`-tier input, a promotion that is deferred on two other
 * entries, and an alarm that binds a cumulative counter.
 */
function checkPump(): void {
  const entry = requireStockEntry(PUMP_CODE);
  assertEntryIdentity(PUMP_CODE, entry, "pump", "mechanical");

  // ---- 20 points, 6 core + 11 extended + 1 manual + 2 derived -------------

  assert(
    tierCount(entry, "core") === 6 &&
      tierCount(entry, "extended") === 11 &&
      tierCount(entry, "manual") === 1 &&
      tierCount(entry, "derived") === 2,
    `§1 marks 6 rows C, 11 X and 1 M, and two of its six derived codes are authored — 6/11/1/2. ` +
      `Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(PUMP_CODE, "§1", entry, PUMP_POINTS);
  assertDerivedPoints(PUMP_CODE, entry, PUMP_DERIVED);
  assertSpecificEnergyIsOneCodeThreeEntries(entry);
  assertNoKpis(PUMP_CODE, entry, "§1");
  assertDeferralsAbsent(PUMP_CODE, entry);

  // ---- head_m legally references an X-tier input --------------------------

  const suction = entry.points.find((point) => point.pointKey === "suction_pressure_bar");
  assert(
    suction?.meta?.tier === "extended" && suction.required === false,
    `${PUMP_CODE}.suction_pressure_bar must stay tier X and optional. head_m references it, and ` +
      "that is LEGAL — the reference check requires the key to be DECLARED, not required (ADR " +
      "0036 decision 7) — so a pump with no suction gauge simply gets no head value. Do not " +
      `"fix" the formula by promoting its input to C. Got tier ${String(suction?.meta?.tier)}, ` +
      `required ${String(suction?.required)}.`,
  );

  // ---- 10 alarms, one of them binding a cumulative counter ----------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(PUMP_CODE, "§1", alarms, PUMP_ALARMS);
  assertPhilosophyRows(PUMP_CODE, alarms);
  assertSkillAssignment(
    PUMP_CODE,
    alarms,
    {
      pump_trip: "mechanical",
      current_high: "electrical",
      current_low: "mechanical",
      discharge_pressure_low: "mechanical",
      de_bearing_temp_high: "mechanical",
      nde_bearing_temp_high: "mechanical",
      vibration_high: "mechanical",
      seal_leak: "mechanical",
      service_due: "mechanical",
      short_cycling: "controls",
    },
    // No process-chemistry row on a pump set: all four of the pack's no-skill
    // rows are the boiler's. Passing an empty list is the claim, not a gap —
    // assertSkillAssignment requires the map and this list to partition the ten.
    [],
  );
  assert(
    alarms.filter((alarm) => alarm.pointKey === "current_a").length === 2,
    `${PUMP_CODE} must carry two alarms on current_a at opposite bands — high is an overload or a ` +
      "blocked impeller and low is a dry run or a broken coupling, which is also why one is " +
      "electrical and the other mechanical. Same shape as the feeder's two voltage_vry rows: " +
      "different meanings at different bands are different rows.",
  );

  const shortCycling = alarms.find((alarm) => alarm.code === "short_cycling");
  const startCount = entry.points.find((point) => point.pointKey === "start_count");
  assert(
    shortCycling?.pointKey === "start_count" && startCount?.kind === "measured",
    `${PUMP_CODE}'s short_cycling alarm must bind the CUMULATIVE COUNTER start_count. ` +
      "starts_per_hour is deferred — bms-calc-v1 has arithmetic and five functions and no state, " +
      "so a per-hour rate is not expressible in a formula — and the alarm text says so: the RATE " +
      "is the rule's to evaluate (E2.4) and the counter is the parameter it evaluates over. Same " +
      `precedent as E5.1's throughput_anomaly. Got "${String(shortCycling?.pointKey)}" on a ` +
      `"${String(startCount?.kind)}" point.`,
  );

  // ---- 4 maintenance plans, none of them safetyCritical -------------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 4, `plan §5.7 authors 4 pump plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 0,
    "no pump plan is safetyCritical — ADR 0053 decision 8 names exactly three in the pack (the " +
      "compressor's relief-valve test, the AHU's fire-trip interlock test and the boiler's " +
      "low-water cut-off and safety-valve test), and none of them is here. A bearing round is " +
      `not a life-safety barrier. Got ${safetyCritical.length}: ` +
      `${safetyCritical.map((plan) => plan.title).join("; ") || "(none)"}`,
  );
  const conditionPlans = plans.filter((plan) => plan.category === "condition_based");
  assert(
    conditionPlans.length === 1 && conditionPlans[0]?.generationMode === "condition",
    `${PUMP_CODE} must carry exactly one condition_based plan, generated in "condition" mode — ` +
      "the bearing inspection. A condition_based plan on a calendar mode is a calendar plan " +
      `wearing the wrong category. Got ${conditionPlans.length} plan(s), mode ` +
      `"${String(conditionPlans[0]?.generationMode)}".`,
  );
  const trigger = String(conditionPlans[0]?.triggerSummary ?? "");
  for (const pointKey of ["vibration_mms", "de_bearing_temp_c", "nde_bearing_temp_c"]) {
    assert(
      trigger.includes(pointKey),
      `${PUMP_CODE}'s bearing-inspection plan must name ${pointKey} in its triggerSummary — the ` +
        "three points whose rise IS the trigger, and the three the vibration_high and the two " +
        "bearing-temperature alarms bind. A condition plan that does not say what condition " +
        `generates it is a calendar plan with a different word on it. Got: "${trigger}"`,
    );
  }
  assertMaintenanceBounds(PUMP_CODE, entry);
  assertProvenance(PUMP_CODE, entry, MECHANICAL_TAG_LIST, "§1");
}

// ===========================================================================
// §2 — `mechanical-vfd`
// ===========================================================================

const VFD_CODE = "mechanical-vfd";

/**
 * §2's 15 table rows in the document's own order (`sortOrder` 0-14) —
 * `[pointKey, tier, unit]`. **There is no derived row and no reused code**: the
 * cheap opposite shape to the pump, and the only entry in the pack that is
 * neither.
 *
 * **All fifteen codes carry the `vfd_` prefix except `motor_temp_c`**, and that
 * is deliberate rather than untidy. ADR 0053 decision 9 makes the drive its own
 * asset on its own register block, so `vfd_power_kw`, `vfd_kwh_total` and
 * `vfd_run_hours_h` are NOT the motor's `kw`, `kwh_total` and `run_hours_h`: the
 * prefix says which device reported the number, and a drive that is powered but
 * not running still accumulates a different hour count from the machine it
 * drives. `motor_temp_c` keeps no prefix because it is the motor's own thermal
 * model or PTC read back through the drive — the one row here that is about the
 * driven machine.
 *
 * `vfd_status`, `vfd_ready` and `vfd_fault` are `0/1` rows and `vfd_fault_code`
 * is a vendor `code` row; all four carry `null`, which the vocabulary spells
 * `""` (ADR 0051 Amendment 6 decision 4). **`vfd_fault_code` is tier C** — the
 * document marks it `C` because a fault flag without its code sends an engineer
 * to the panel to read the display; the chiller's equivalent row is `X`, and the
 * two are not to be normalised into one tier.
 */
const VFD_POINTS: readonly PointRow[] = [
  ["vfd_status", "core", null],
  ["vfd_ready", "extended", null],
  ["vfd_fault", "core", null],
  ["vfd_fault_code", "core", null],
  ["vfd_output_freq_hz", "core", "Hz"],
  ["vfd_speed_ref_pct", "core", "%"],
  ["vfd_output_current_a", "core", "A"],
  ["vfd_output_voltage_v", "extended", "V"],
  ["vfd_dc_bus_v", "extended", "V"],
  ["vfd_torque_pct", "extended", "%"],
  ["vfd_power_kw", "extended", "kW"],
  ["vfd_kwh_total", "extended", "kWh"],
  ["vfd_heatsink_temp_c", "extended", "°C"],
  ["motor_temp_c", "extended", "°C"],
  ["vfd_run_hours_h", "core", "h"],
];

/**
 * §2's six alarm bullets become **seven** rows. *"DC bus over/under-voltage
 * (supply quality)"* splits into two rows binding `vfd_dc_bus_v` at opposite
 * bands — the pump's `current_a` shape and the feeder's `voltage_vry` shape: a
 * high bus is a regenerating load or a high supply and a low bus is a dip or a
 * lost phase, and the two are answered differently.
 *
 * **No alarm binds `vfd_fault_code`.** `drive_fault` binds the `0/1` flag beside
 * it and carries the vendor code in its own text — ADR 0053 decision 5's rule
 * that vendor fault codes are named in the message and never enumerated, because
 * an enum per OEM is a v2 shape and a wrong one is worse than none.
 */
const VFD_ALARMS: readonly AlarmRow[] = [
  ["drive_fault", "vfd_fault", "critical", "operations"],
  ["overcurrent", "vfd_output_current_a", "warning", "operations"],
  ["dc_bus_overvoltage", "vfd_dc_bus_v", "warning", "operations"],
  ["dc_bus_undervoltage", "vfd_dc_bus_v", "warning", "operations"],
  ["heatsink_temp_high", "vfd_heatsink_temp_c", "warning", "operations"],
  ["motor_temp_high", "motor_temp_c", "warning", "operations"],
  ["speed_reference_not_followed", "vfd_output_freq_hz", "warning", "operations"],
];

/**
 * `mechanical-vfd` against `docs/e5.2-derived-taglist-v1.md` §2 (plan §5.2) —
 * **the entry that promotes nothing**. §2 names three derived codes and all
 * three need the motor's nameplate, so the entry authors no formula at all: the
 * cheap opposite of the pump, and the proof that a section with a *Derived:*
 * line does not owe the vocabulary a promotion.
 */
function checkVfd(): void {
  const entry = requireStockEntry(VFD_CODE);
  assertEntryIdentity(VFD_CODE, entry, "vfd", "mechanical");

  // ---- 15 points, 7 core + 8 extended + 0 manual + 0 derived --------------

  assert(
    tierCount(entry, "core") === 7 &&
      tierCount(entry, "extended") === 8 &&
      tierCount(entry, "manual") === 0 &&
      tierCount(entry, "derived") === 0,
    `§2 marks 7 rows C and 8 X, has no M row, and promotes none of its three derived codes — ` +
      `7/8/0/0. Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(VFD_CODE, "§2", entry, VFD_POINTS);

  // The empty table is the claim, not an omission: §2's `motor_load_pct`,
  // `speed_pct` and `energy_saving_vs_dol_kwh` all divide by a NAMEPLATE value
  // the drive does not report, so none is expressible over measured siblings and
  // none is promoted. A later author "helpfully" hardcoding ÷ 50 Hz for
  // speed_pct fails here first, which is where it should fail.
  assertDerivedPoints(VFD_CODE, entry, []);
  assertNoKpis(VFD_CODE, entry, "§2");
  assertDeferralsAbsent(VFD_CODE, entry);

  // ---- 7 alarms, two of them at opposite bands on one point ---------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(VFD_CODE, "§2", alarms, VFD_ALARMS);
  assertPhilosophyRows(VFD_CODE, alarms);
  assertSkillAssignment(
    VFD_CODE,
    alarms,
    {
      drive_fault: "electrical",
      overcurrent: "electrical",
      dc_bus_overvoltage: "electrical",
      dc_bus_undervoltage: "electrical",
      heatsink_temp_high: "electrical",
      motor_temp_high: "electrical",
      // The one row whose cause is on the driven machine and not in the panel:
      // the drive is doing what it was told and the load will not turn.
      speed_reference_not_followed: "mechanical",
    },
    // No process-chemistry row on a drive: all four of the pack's no-skill rows
    // are the boiler's. The empty list is a claim — assertSkillAssignment
    // requires the map and this list to partition the seven.
    [],
  );

  const dcBus = alarms.filter((alarm) => alarm.pointKey === "vfd_dc_bus_v");
  assert(
    dcBus.length === 2 &&
      dcBus[0]?.code === "dc_bus_overvoltage" &&
      dcBus[1]?.code === "dc_bus_undervoltage",
    `${VFD_CODE} must carry TWO alarms on vfd_dc_bus_v at opposite bands — §2's one bullet ("DC ` +
      "bus over/under-voltage\") is two events with two causes: a high bus is a high supply or a " +
      "regenerating load with no brake resistor to take it, and a low bus is a supply dip or a " +
      "lost input phase. One row with a message saying \"high or low\" is a row an operator " +
      "cannot act on, because the two actions are opposite. Same shape as the feeder's two " +
      `voltage_vry rows and the pump's two current_a rows. Got ` +
      `${dcBus.length}: [${dcBus.map((alarm) => alarm.code).join(", ")}]`,
  );

  const faultCode = entry.points.find((point) => point.pointKey === "vfd_fault_code");
  assert(
    faultCode?.meta?.tier === "core" &&
      alarms.every((alarm) => alarm.pointKey !== "vfd_fault_code"),
    `${VFD_CODE} must declare vfd_fault_code as a tier C point that NO alarm binds. §2 marks it C ` +
      "because a fault flag without its code sends an engineer to the panel to read the display; " +
      "drive_fault binds the 0/1 vfd_fault flag beside it and carries the vendor code in its own " +
      "TEXT, because enumerating one OEM's fault list is a v2 shape and a wrong enum is worse " +
      `than none (ADR 0053 decision 5). Got tier ${String(faultCode?.meta?.tier)}, bound by ` +
      `${alarms.filter((alarm) => alarm.pointKey === "vfd_fault_code").length} alarm(s).`,
  );

  // ---- 3 maintenance plans, none critical and none condition-based --------

  const plans = maintenanceOf(entry);
  assert(plans.length === 3, `plan §5.7 authors 3 VFD plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 0,
    "no VFD plan is safetyCritical — ADR 0053 decision 8 names exactly three in the pack (the " +
      "compressor's relief-valve test, the AHU's fire-trip interlock test and the boiler's " +
      "low-water cut-off and safety-valve test), and none of them is here. A capacitor " +
      `inspection is a reliability task, not a life-safety barrier. Got ${safetyCritical.length}: ` +
      `${safetyCritical.map((plan) => plan.title).join("; ") || "(none)"}`,
  );
  // Unlike the pump and the chiller, this entry has NO condition_based plan and
  // that is the correct authoring, not an omission: a drive's three tasks are
  // calendar work — a clean, a torque check and a parameter backup — and there
  // is no measured row whose rise is a trigger. `heatsink_temp_high` is an alarm
  // an operator answers, not a work order a plan generates.
  const conditionPlans = plans.filter((plan) => plan.category === "condition_based");
  assert(
    conditionPlans.length === 0 && plans.every((plan) => plan.generationMode === "calendar"),
    `${VFD_CODE} must carry NO condition_based plan and every plan in "calendar" mode — §5.7 ` +
      "authors a cooling-fan and heatsink clean, a power-terminal torque check with a DC-bus " +
      "capacitor inspection, and a parameter backup with a fault-log review. All three are " +
      `calendar work. Got ${conditionPlans.length} condition_based plan(s), modes [` +
      `${plans.map((plan) => String(plan.generationMode)).join(", ")}].`,
  );
  assertMaintenanceBounds(VFD_CODE, entry);
  assertProvenance(VFD_CODE, entry, MECHANICAL_TAG_LIST, "§2");
}

/**
 * Every per-class block in this file. Called by `mechanical-classes.test.ts`,
 * its name-sibling wrapper. **§3 and §4 live in `mechanical-classes-2.spec.ts`
 * and §6 and §7 in `-3`** — two entries per file, so no file in this directory
 * approaches the §4.5 cap.
 */
export function runMechanicalClassEntryTests(): void {
  checkPump();
  checkVfd();
}
