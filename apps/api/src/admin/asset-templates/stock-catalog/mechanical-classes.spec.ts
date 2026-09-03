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

/**
 * Every per-class block in this file. Called by `mechanical-classes.test.ts`,
 * its name-sibling wrapper. **Task 7 appends `checkVfd()` below `checkPump()`
 * and changes nothing else in this file.**
 */
export function runMechanicalClassEntryTests(): void {
  checkPump();
}
