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
 * `E5.2` pass C, the third and last of the transcription spec files — §6 (air
 * handling unit) and §7 (steam boiler) of `docs/e5.2-derived-taglist-v1.md`.
 *
 * **Two entries per file, three files** — the cap `E5.1` measured at its own
 * first escalation checkpoint, and the §4.5 pre-commit guard reads a whole
 * file. §1 and §2 are in `mechanical-classes.spec.ts`, §3 and §4 in `-2`, §6
 * and §7 here (plan Task 10 and Task 11). **This file is created with the AHU
 * block alone and the boiler block appends to it** — the runner at the foot is
 * the seam, so Task 11 adds one `check…()` call and nothing else moves.
 *
 * **The two entries in this file close the pack, and each carries something no
 * earlier entry did.** The AHU is the first stock entry anywhere to file an
 * alarm under `comfort`, and it binds a motor current for a fan run status its
 * own tag-list section does not carry — a v2 redline candidate recorded rather
 * than invented. The boiler carries the pack's only rows with **no**
 * `philosophy.skill` (four process-chemistry rows, because `bms.alarm_skills`
 * has no process trade), the pack's only `assertNoLimitNumbers` call outside
 * the water pack, and the dual-tier row.
 *
 * **Every helper is imported from `stock-transcription.spec.ts`, not restated**
 * — the same discipline the two sibling files record. `MECHANICAL_TAG_LIST`
 * comes from the first of them rather than being spelled a second time: the
 * document name is a needle `assertProvenance` looks for in every entry's
 * description, and two spellings of it would be two claims that could drift
 * apart.
 *
 * **`mechanical-classes-3.test.ts` is this file's name-sibling wrapper** —
 * `tests/repo-invariants.test.ts` matches the pair by name, and a spec imported
 * from a differently-named wrapper still runs but is absent from coverage.
 */

// ===========================================================================
// §6 — `hvac-ahu`
// ===========================================================================

const AHU_CODE = "hvac-ahu";

/**
 * §6's 26 table rows in the document's own order (`sortOrder` 0-25), then the
 * two authored derived codes at 26-27 — `[pointKey, tier, unit]`.
 *
 * §6 opens with **ASHRAE Guideline 36's required AFDD points** — supply,
 * return, mixed and outdoor air temperatures, duct static, the two setpoints,
 * the coil valve and the fan speed — and the extras follow. The order below is
 * the document's, not a tidied one, and `assertPointTable` pins `sortOrder`
 * to the index.
 *
 * **Nine of the twenty-six rows are reused codes, referenced and redeclared
 * nowhere** (ADR 0053 decision 3): `supply_air_temp_c`, `return_air_temp_c`,
 * `fan_speed_pct`, `fan_rpm` and `fan_current_a` are five of
 * `HVAC_POINT_KEYS`'s nine, and `chw_supply_temp_c`, `chw_return_temp_c`, `kw`
 * and `run_hours_h` are the codes the chiller and the pump already name. The
 * two chilled-water temperatures are **the same meaning at a different place**
 * — leaving and entering at the chiller, coil entering and coil leaving here —
 * which is one meaning per ADR 0051 Amendment 6 decision 5, so the AHU names
 * them rather than minting a `coil_chw_*` pair.
 *
 * **`fan_rpm` carries `RPM` and not the document's `rpm`.** The catalogue
 * already spells it `RPM`, a template `unit` is an OVERRIDE, and overriding a
 * catalogue unit with a different spelling of the same unit would ship two
 * spellings of one unit to every organization that imports the entry — which a
 * later seed could not correct, because `seedPointKeyCatalog` inserts with
 * `COALESCE`. This triple is the only check in the repository that reads a
 * template unit at all.
 *
 * **There is no `fan_status` row, and its absence is the entry's one recorded
 * redline candidate.** §6 carries `ahu_status` (the unit's own run status) and
 * no fan run status, yet its own alarm bullet is *"fan running with no status
 * (belt / VFD)"*. The alarm binds `fan_current_a` instead; the check below
 * asserts both halves, so the day a v2 redline adds the row, this line is what
 * a reader finds.
 *
 * The four `0/1` rows carry `null`, which the vocabulary spells `""` (ADR 0051
 * Amendment 6 decision 4). §6 marks **no `M` row at all** — the first entry in
 * the pack with none since the VFD.
 */
const AHU_POINTS: readonly PointRow[] = [
  ["ahu_status", "core", null],
  ["ahu_fault", "core", null],
  ["supply_air_temp_c", "core", "°C"],
  ["supply_air_temp_sp_c", "core", "°C"],
  ["return_air_temp_c", "core", "°C"],
  ["mixed_air_temp_c", "extended", "°C"],
  ["outdoor_air_temp_c", "extended", "°C"],
  ["return_air_rh_pct", "core", "%"],
  ["supply_air_rh_pct", "extended", "%"],
  ["duct_static_pa", "core", "Pa"],
  ["duct_static_sp_pa", "core", "Pa"],
  ["fan_speed_pct", "core", "%"],
  ["fan_rpm", "extended", "RPM"],
  ["fan_current_a", "extended", "A"],
  ["return_fan_speed_pct", "extended", "%"],
  ["chw_valve_pct", "core", "%"],
  ["chw_supply_temp_c", "extended", "°C"],
  ["chw_return_temp_c", "extended", "°C"],
  ["oa_damper_pct", "extended", "%"],
  ["ra_damper_pct", "extended", "%"],
  ["filter_dp_pa", "core", "Pa"],
  ["filter_dirty_state", "extended", null],
  ["return_air_co2_ppm", "extended", "ppm"],
  ["fire_trip_state", "core", null],
  ["kw", "extended", "kW"],
  ["run_hours_h", "core", "h"],
  ["sat_deviation_c", "derived", "°C"],
  ["coil_delta_t_c", "derived", "°C"],
];

/**
 * §6's two expressible derived codes, as literal strings (plan §5.0).
 *
 * `sat_deviation_c` is **the G36 AFDD quantity this entry exists to make
 * reviewable**: supply air temperature minus its setpoint, both tier C, so it
 * computes on every unit the template is imported onto. It is **signed on
 * purpose** — the order of the two terms is the difference between "the coil is
 * not holding the air down" and "the unit is overcooling", and both are real
 * faults with opposite remedies. `sat_deviation_high` binds it.
 *
 * `coil_delta_t_c` is the ΔT across the cooling coil, from the two chilled-water
 * temperatures. Both its inputs are tier **X**, which is legal — the reference
 * check requires a key to be DECLARED and not required (ADR 0036 decision 7) —
 * and it means an AHU with no coil-water thermometry simply gets no value. Do
 * not "fix" that by promoting the inputs to C: a required point with a null
 * pattern is a 400 at instantiation, on every site that never fitted them.
 *
 * Neither overrides `maxInputAgeSeconds`: air temperatures, a setpoint and two
 * water temperatures all arrive from the unit's own controller at one scan rate,
 * inside the 300 s default. There is no `approach_c`-shaped override anywhere in
 * this pack, so a "helpful" one fails here with a reason.
 */
const AHU_DERIVED: readonly DerivedRow[] = [
  ["sat_deviation_c", "{supply_air_temp_c} - {supply_air_temp_sp_c}", null],
  ["coil_delta_t_c", "{chw_return_temp_c} - {chw_supply_temp_c}", null],
];

/**
 * §6's eight alarm bullets become **eight** rows — one per bullet, as the
 * compressor's and the chiller's did.
 *
 * **Three are `comfort`, and this is the first stock entry anywhere to use that
 * category** (plan §12 ruling 6). `comfort` is one of migration `0029`'s four
 * concerns and had never been authored: `sat_deviation_high`, `return_rh_high`
 * and `co2_high` are all about what the occupants of a space are given — air off
 * setpoint, humidity the coil is not removing, and ventilation air that is
 * short — and an AHU serves those occupants directly. The chiller's equivalent
 * row (`chw_leaving_temp_high`) is deliberately `operations` instead, because a
 * chiller serves a loop whose load is unknown to it.
 *
 * `fire_trip` is `safety` and **`sat_deviation_high` binds the derived point**
 * `sat_deviation_c`, the second of the pack's two alarms on a computed point
 * (the chiller's `kw_per_tr_high` is the other).
 */
const AHU_ALARMS: readonly AlarmRow[] = [
  ["ahu_fault", "ahu_fault", "critical", "operations"],
  ["sat_deviation_high", "sat_deviation_c", "warning", "comfort"],
  ["duct_static_low", "duct_static_pa", "warning", "operations"],
  ["filter_dp_high", "filter_dp_pa", "warning", "operations"],
  ["return_rh_high", "return_air_rh_pct", "warning", "comfort"],
  ["co2_high", "return_air_co2_ppm", "warning", "comfort"],
  ["fire_trip", "fire_trip_state", "critical", "safety"],
  ["supply_fan_not_running", "fan_current_a", "warning", "operations"],
];

/**
 * **The cross-entry claim, asserted from the block that arrives second** — the
 * `assertRecoveryIsOneCodeTwoFormulas` precedent `E5.1` set, inverted: there one
 * code carried two formulas, here **two codes carry one formula string over the
 * same two vocabulary codes**.
 *
 * `chw_delta_t_c` (chiller, §4) and `coil_delta_t_c` (AHU, §6) are both
 * `{chw_return_temp_c} - {chw_supply_temp_c}`. The document names them
 * separately because one is the plant loop ΔT measured at the machine and the
 * other is the ΔT across one coil — the same arithmetic over the same two codes,
 * read at two different places in the same water circuit, and a plant with a low
 * loop ΔT and a coil doing its job is a real and diagnosable state that one
 * merged code could not express.
 *
 * **Plan §12 question 4 asked whether to merge them and the owner ruled to keep
 * both** (2026-09-03): the tag list is the handout a client redlines, a merge is
 * a one-line redline the client can make, and a plan-side merge would silently
 * edit the handout before anybody read it. This assertion is that ruling, made
 * permanent from the AHU's block — a later author "tidying" the duplicate away
 * has to delete this line and read the reason first.
 */
function assertOneFormulaTwoCodes(): void {
  const shared = "{chw_return_temp_c} - {chw_supply_temp_c}";
  const ahu = requireStockEntry(AHU_CODE).points.find(
    (point) => point.pointKey === "coil_delta_t_c",
  );
  const chiller = requireStockEntry("hvac-chiller").points.find(
    (point) => point.pointKey === "chw_delta_t_c",
  );
  assert(
    ahu?.formula === shared && chiller?.formula === shared,
    `coil_delta_t_c on ${AHU_CODE} and chw_delta_t_c on hvac-chiller must BOTH be exactly ` +
      `"${shared}" — two codes, one formula string, over the same two vocabulary codes. The ` +
      "document names them separately because one is the plant loop ΔT at the machine and the " +
      "other is the ΔT across one coil, and plan §12 ruling 4 kept both: the tag list is the " +
      "handout a client redlines, and merging them plan-side would edit that handout before " +
      `anybody read it. Got AHU "${String(ahu?.formula)}" and chiller ` +
      `"${String(chiller?.formula)}".`,
  );
  assert(
    ahu?.pointKey !== chiller?.pointKey,
    "coil_delta_t_c and chw_delta_t_c must stay two distinct codes — the same formula is not the " +
      "same meaning, and both are promoted vocabulary in HVAC_CLASS_POINT_KEYS",
  );
}

/**
 * `hvac-ahu` against `docs/e5.2-derived-taglist-v1.md` §6 (plan §5.5) — the
 * **second** stock entry filed under `hvac`, the first anywhere to file an alarm
 * under `comfort`, and the entry that records a missing tag-list row rather than
 * inventing one.
 */
function checkAhu(): void {
  const entry = requireStockEntry(AHU_CODE);
  assertEntryIdentity(AHU_CODE, entry, "ahu", "hvac");

  // ---- 28 points, 13 core + 13 extended + 0 manual + 2 derived ------------

  assert(
    tierCount(entry, "core") === 13 &&
      tierCount(entry, "extended") === 13 &&
      tierCount(entry, "manual") === 0 &&
      tierCount(entry, "derived") === 2,
    `§6 marks 13 rows C and 13 X, has no M row, and two of its five derived codes are authored — ` +
      `13/13/0/2. Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(AHU_CODE, "§6", entry, AHU_POINTS);
  assertDerivedPoints(AHU_CODE, entry, AHU_DERIVED);
  assertOneFormulaTwoCodes();
  assertNoKpis(AHU_CODE, entry, "§6");
  assertDeferralsAbsent(AHU_CODE, entry);

  // ---- coil_delta_t_c legally references two X-tier inputs ----------------

  for (const pointKey of ["chw_supply_temp_c", "chw_return_temp_c"]) {
    const water = entry.points.find((point) => point.pointKey === pointKey);
    assert(
      water?.meta?.tier === "extended" && water.required === false,
      `${AHU_CODE}.${pointKey} must stay tier X and optional. coil_delta_t_c references it, and ` +
        "that is LEGAL — the reference check requires the key to be DECLARED, not required (ADR " +
        "0036 decision 7) — so an AHU with no coil-water thermometry simply gets no ΔT. Do not " +
        "\"fix\" the formula by promoting its inputs to C: a required point with a null pattern " +
        `is a 400 at instantiation on every site that never fitted them. Got tier ` +
        `${String(water?.meta?.tier)}, required ${String(water?.required)}.`,
    );
  }

  // ---- 8 alarms, three of them comfort, one bound to a derived point ------

  const alarms = alarmsOf(entry);
  assertAlarmTable(AHU_CODE, "§6", alarms, AHU_ALARMS);
  assertPhilosophyRows(AHU_CODE, alarms);
  assertSkillAssignment(
    AHU_CODE,
    alarms,
    {
      ahu_fault: "hvac",
      sat_deviation_high: "hvac",
      duct_static_low: "hvac",
      filter_dp_high: "hvac",
      return_rh_high: "hvac",
      co2_high: "hvac",
      // Plan §12 ruling 7. The fire system, not a trade, answers the event; the
      // AHU is restarted by the HVAC trade after the all-clear, and the action
      // text says not to restart until the fire system resets. The alternative
      // was no skill, which would have widened the "no seeded trade answers
      // this" class from process chemistry to a life-safety row.
      fire_trip: "hvac",
      // The one row that is not the HVAC trade's: a fan commanded with no motor
      // current is a belt, a coupling or a drive — the mechanical trade's work
      // on a machine the HVAC trade owns.
      supply_fan_not_running: "mechanical",
    },
    // No process-chemistry row on an air handler: all four of the pack's
    // no-skill rows are the boiler's. The empty list is a claim, not a gap —
    // assertSkillAssignment requires the map and this list to partition the
    // eight.
    [],
  );

  const comfortRows = alarms
    .filter((alarm) => alarm.category === "comfort")
    .map((alarm) => alarm.code);
  assert(
    comfortRows.join(",") === "sat_deviation_high,return_rh_high,co2_high",
    `${AHU_CODE} must file exactly sat_deviation_high, return_rh_high and co2_high as "comfort" ` +
      "(plan §12 ruling 6) — and this is the FIRST use of that category by any stock entry, " +
      "though migration 0029 has seeded it since the beginning. All three are about what the " +
      "occupants of a space are given: air off setpoint, humidity the coil is not removing, and " +
      "ventilation air that is short. The chiller's chw_leaving_temp_high is operations instead, " +
      `because a chiller serves a loop whose load is unknown to it. Got [${comfortRows.join(", ")}].`,
  );

  const satDeviation = entry.points.find((point) => point.pointKey === "sat_deviation_c");
  const satAlarm = alarms.find((alarm) => alarm.code === "sat_deviation_high");
  assert(
    satAlarm?.pointKey === "sat_deviation_c" && satDeviation?.kind === "derived",
    `${AHU_CODE}'s sat_deviation_high alarm must bind the DERIVED point sat_deviation_c — the G36 ` +
      "AFDD quantity this entry exists to make reviewable, and the second of the pack's two " +
      "alarms on a computed point (the chiller's kw_per_tr_high is the other). A promoted derived " +
      "code is what makes that binding possible at all: an alarm binds a declared POINT, and a " +
      `content.kpis entry could not be bound. Got "${String(satAlarm?.pointKey)}" on a ` +
      `"${String(satDeviation?.kind)}" point.`,
  );

  // ---- the fan status §6 does not carry ----------------------------------

  const fanAlarm = alarms.find((alarm) => alarm.code === "supply_fan_not_running");
  assert(
    fanAlarm?.pointKey === "fan_current_a",
    `${AHU_CODE}'s supply_fan_not_running alarm must bind fan_current_a. §6's bullet is "fan ` +
      "running with no status (belt / VFD)\" and the section declares NO fan run status at all — " +
      "ahu_status is the unit's, not the fan's — so the alarm binds the motor current instead: no " +
      "current with the fan commanded is a broken belt, a slipping coupling or a drive that is " +
      `not running. Got "${String(fanAlarm?.pointKey)}".`,
  );
  const declared = new Set(entry.points.map((point) => point.pointKey));
  assert(
    !declared.has("fan_status"),
    `${AHU_CODE} must NOT declare fan_status. E5.1 §4.2 flagged it as the global code an AHU ` +
      "should reuse, and the E5.2 tag list's §6 table does not carry it — so declaring it here " +
      "would put a row in a shipped entry that the cited source does not contain, which is the " +
      "one thing a PROVISIONAL transcription may not do. The absence is recorded as a v2 REDLINE " +
      "CANDIDATE in the module docblock (the dosing_tank_level_pct shape from E5.1), and the " +
      "alarm binds the current until the client's redline adds the row.",
  );
  assert(
    /status/i.test(String(fanAlarm?.message)),
    `${AHU_CODE}'s supply_fan_not_running message must say that the fan run status is missing — ` +
      "an operator reading \"fan not running\" on a current alarm needs to know the platform is " +
      "inferring it, and the next author needs to know the binding is deliberate rather than a " +
      `mistake. Got: "${String(fanAlarm?.message)}"`,
  );

  // ---- 4 maintenance plans, ONE of them safetyCritical --------------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 4, `plan §5.7 authors 4 AHU plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 1 &&
      safetyCritical[0]?.category === "safety_critical" &&
      safetyCritical[0]?.priority === "critical" &&
      /fire/i.test(String(safetyCritical[0]?.title)),
    `${AHU_CODE} must carry exactly ONE safetyCritical plan — the fire-trip interlock test, the ` +
      "second of the three ADR 0053 decision 8 names for this pack (the other two are the " +
      "compressor's relief-valve test and the boiler's low-water cut-off and safety-valve test). " +
      "An air handler that keeps running through a fire signal moves smoke through a building, " +
      "and the interlock is the barrier that stops it; it is category safety_critical at priority " +
      `critical for that reason. Got ${safetyCritical.length}: ` +
      `${safetyCritical.map((plan) => plan.title).join("; ") || "(none)"}`,
  );
  const conditionPlans = plans.filter((plan) => plan.category === "condition_based");
  assert(
    conditionPlans.length === 1 && conditionPlans[0]?.generationMode === "condition",
    `${AHU_CODE} must carry exactly one condition_based plan, generated in "condition" mode — the ` +
      "filter change. A condition_based plan on a calendar mode is a calendar plan wearing the " +
      `wrong category. Got ${conditionPlans.length} plan(s), mode ` +
      `"${String(conditionPlans[0]?.generationMode)}".`,
  );
  const filterTrigger = String(conditionPlans[0]?.triggerSummary ?? "");
  assert(
    filterTrigger.includes("filter_dp_pa"),
    `${AHU_CODE}'s filter-change plan must name filter_dp_pa in its triggerSummary — the point ` +
      "whose rise IS the trigger, and the point filter_dp_high binds. A filter is changed when it " +
      "is loaded and not when the calendar says so: the differential pressure is the measurement " +
      "that says which, and filter_life_pct (the percentage a reader would rather see) is " +
      `deferred because the clean and dirty band is per filter class. Got: "${filterTrigger}"`,
  );
  assertMaintenanceBounds(AHU_CODE, entry);
  assertProvenance(AHU_CODE, entry, MECHANICAL_TAG_LIST, "§6");
}

/**
 * Every per-class block in this file. Called by `mechanical-classes-3.test.ts`,
 * its name-sibling wrapper. **§1 to §4 live in `mechanical-classes.spec.ts` and
 * `-2`** — two entries per file, so no file in this directory approaches the
 * §4.5 cap.
 */
export function runMechanicalClassEntryTests3(): void {
  checkAhu();
}
