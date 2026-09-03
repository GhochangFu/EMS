import { MECHANICAL_TAG_LIST } from "./mechanical-classes.spec";
import { alarmsOf, assert, maintenanceOf, requireStockEntry } from "./stock-catalog.spec";
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

// ===========================================================================
// §7 — `mechanical-boiler`
// ===========================================================================

const BOILER_CODE = "mechanical-boiler";

/**
 * The `why` the boiler's four statutory rows pass to `assertNoLimitNumbers`.
 *
 * The helper is pack-neutral and takes the regime as an argument for exactly
 * this reason: the water pack passes its CPCB Schedule VI discharge-consent
 * sentence, and this pack passes the boiler's IBR one. The rule is the same and
 * the regime is not, and a message naming the wrong regulator sends the reader
 * to the wrong document.
 */
const IBR_REGIME =
  "This is an Indian Boiler Regulations row: the low-water level, the safety-valve set pressure " +
  "and the operating band are per boiler, fixed on its own certificate by its inspecting " +
  "authority, and recorded on its log sheet (ADR 0053 decision 5, B7).";

/**
 * §7's 23 table rows in the document's own order (`sortOrder` 0-22), then the
 * two authored derived codes at 23-24 — `[pointKey, tier, unit]`.
 *
 * **`feedwater_tds_ppm` is `extended`, and it is the pack's ONE dual-tier row.**
 * §7 spells its tier `X/M` and ADR 0053 decision 4 resolves a dual-tier row
 * **first-listed wins**, as the water pack's two did. It is an online analyser on
 * a plant that has one and a laboratory sample on a plant that does not, and the
 * document lists the analyser first. The check below asserts it by name, because
 * this is the only row in the pack where reading the tier off the table needs a
 * ruling rather than a column.
 *
 * **Row thirteen is `fuel_level_pct`, the DG SET's code, reused** (plan §12
 * ruling 1). §7 spells it `fuel_tank_level_pct` and the tag list's own
 * cross-cutting note says existing keys are reused rather than renamed: *day-tank
 * / bunker level* and the DG set's *fuel level (day tank)* are one meaning, and
 * one meaning is one code (ADR 0051 Amendment 6 decision 5). The document's
 * spelling is corrected at closure rather than minted as a second key, and this
 * is why the entry's alarm code and its bound point disagree by name — see the
 * check below, which says so rather than leaving it to look like a typo.
 *
 * **Two `M` rows** — `boiler_water_ph` and `blowdown_tds_ppm`, both laboratory
 * values written on a sheet — which carry a null `sourceDataKeyPattern` forever
 * and never get an `asset_points` row. `blowdown_tds_ppm` is also why
 * `blowdown_pct` is deferred: the formula parses and its input can never arrive.
 *
 * `run_hours_h` is the entry's one other reused code. The four `0/1` rows carry
 * `null`, which the vocabulary spells `""`, and so does the dimensionless
 * `steam_to_fuel_ratio`. `furnace_draft_mmwc` carries `mmWC` and
 * `boiler_water_ph` carries `pH`, both spelled as `UNIT_BY_KEY` spells them.
 */
const BOILER_POINTS: readonly PointRow[] = [
  ["boiler_status", "core", null],
  ["boiler_trip", "core", null],
  ["steam_pressure_bar", "core", "bar"],
  ["steam_temp_c", "extended", "°C"],
  ["steam_flow_kgh", "extended", "kg/hr"],
  ["steam_totalizer_kg", "extended", "kg"],
  ["drum_level_pct", "core", "%"],
  ["feedwater_flow_kgh", "extended", "kg/hr"],
  ["feedwater_temp_c", "extended", "°C"],
  ["feedwater_tds_ppm", "extended", "ppm"],
  ["feed_pump_status", "core", null],
  ["fuel_flow_kgh", "extended", "kg/hr"],
  ["fuel_totalizer_kg", "extended", "kg"],
  ["fuel_level_pct", "extended", "%"],
  ["flue_gas_temp_c", "core", "°C"],
  ["flue_o2_pct", "extended", "%"],
  ["flue_co_ppm", "extended", "ppm"],
  ["combustion_air_temp_c", "extended", "°C"],
  ["furnace_draft_mmwc", "extended", "mmWC"],
  ["blowdown_state", "extended", null],
  ["run_hours_h", "core", "h"],
  ["boiler_water_ph", "manual", "pH"],
  ["blowdown_tds_ppm", "manual", "ppm"],
  ["steam_to_fuel_ratio", "derived", null],
  ["excess_air_pct", "derived", "%"],
];

/**
 * §7's two expressible derived codes, as literal strings (plan §5.0).
 *
 * `steam_to_fuel_ratio` is the document's own *steam ÷ fuel* — kilograms of
 * steam per kilogram of fuel, the figure a boiler house is judged on day to day.
 * Dimensionless, so the vocabulary spells its unit `""` and the template `null`.
 * Both inputs are tier X: a boiler with no steam meter or no fuel meter gets no
 * value, which is legal (the reference check requires a key to be DECLARED, not
 * required) and honest.
 *
 * `excess_air_pct` is the textbook simplified relation from flue-gas oxygen on a
 * dry basis, and **`20.9` is the volume fraction of oxygen in air** — an
 * atmospheric constant, not a site value and not a limit, so B7 (which governs
 * alarm thresholds) has nothing to say about it. Plan §12 question 3 asked
 * whether to promote it at all, given that §7 names it *"from O₂"* without
 * writing a formula, and **the owner ruled to promote it and to defer
 * `specific_fuel_kg_ton_steam`**, which would have been a second code for the
 * reciprocal of the ratio above. **This is the only place in the entry where the
 * number `20.9` may appear**: the four statutory alarm rows carry no digit at
 * all, and `assertNoLimitNumbers` below is what holds that line.
 *
 * Division by zero needs no guard: `evaluate.ts` returns `non_finite`, so the
 * ratio at zero fuel flow — a boiler that is not firing — and the excess air at
 * exactly the oxygen fraction of air yield no value for that reading rather than
 * a fabricated one. **Neither overrides `maxInputAgeSeconds`**; both are `null`,
 * and there is no override anywhere in this pack.
 */
const BOILER_DERIVED: readonly DerivedRow[] = [
  ["steam_to_fuel_ratio", "{steam_flow_kgh} / {fuel_flow_kgh}", null],
  ["excess_air_pct", "{flue_o2_pct} / (20.9 - {flue_o2_pct}) * 100", null],
];

/**
 * §7's nine alarm bullets become **eleven** rows: drum level, steam pressure and
 * flue-gas oxygen each split into two rows at opposite bands, because a level
 * that is too low and a level that is too high are two different failures with
 * two different remedies — the same shape as the pump's two current rows and the
 * feeder's two voltage rows.
 *
 * **Four rows are `safety` and they are the entry's statutory half.**
 * `drum_level_low` is the IBR-critical one: the low-water cut-off is the last
 * barrier before the tubes are uncovered. `steam_pressure_high` is the approach
 * to safety-valve lift, `flue_o2_low` is incomplete combustion with its carbon
 * monoxide risk, and `co_high` is that risk measured directly. Two rows are
 * `energy` — a hot stack and excess air are both continuous costs on a machine
 * that is still making steam — and the remaining five are `operations`.
 *
 * **Four rows carry NO `philosophy.skill`, and they are the only four in the
 * pack.** `flue_o2_high`, `flue_o2_low`, `co_high` and `feedwater_tds_high` are
 * combustion and water-chemistry excursions, and `bms.alarm_skills` holds
 * exactly `electrical`, `mechanical`, `hvac`, `controls` and `civil` — **no
 * process trade** (`F4.78` files it). The field is omitted rather than routed to
 * a trade that does not answer the event, and `assertSkillAssignment` is called
 * with the seven assigned rows AND these four, which must partition the eleven.
 */
const BOILER_ALARMS: readonly AlarmRow[] = [
  ["boiler_trip", "boiler_trip", "critical", "safety"],
  ["drum_level_low", "drum_level_pct", "critical", "safety"],
  ["drum_level_high", "drum_level_pct", "warning", "operations"],
  ["steam_pressure_high", "steam_pressure_bar", "critical", "safety"],
  ["steam_pressure_low", "steam_pressure_bar", "warning", "operations"],
  ["flue_gas_temp_high", "flue_gas_temp_c", "warning", "energy"],
  ["flue_o2_high", "flue_o2_pct", "warning", "energy"],
  ["flue_o2_low", "flue_o2_pct", "critical", "safety"],
  ["co_high", "flue_co_ppm", "critical", "safety"],
  ["feedwater_tds_high", "feedwater_tds_ppm", "warning", "operations"],
  ["fuel_tank_level_low", "fuel_level_pct", "warning", "operations"],
];

/**
 * The four rows whose limit is set by a statute and an inspecting authority
 * rather than by an engineer's judgement, and which therefore carry the MEANING
 * and never a number — in the message *and* inside every `philosophy` string,
 * which is the half `checkEntry`'s pair-absence check cannot see.
 *
 * These four and not the two bands they belong to: `drum_level_high` (carryover)
 * and `steam_pressure_low` (demand exceeding firing) are operating rows an
 * engineer sets from the plant's own behaviour, while a low-water level, a
 * safety-valve set pressure and the oxygen floor beneath which combustion goes
 * incomplete are the boiler's certificate and the regulations behind it. A number
 * shipped unread to every organization that imports this entry is a number
 * somebody will believe, and on these four believing the wrong one is how a
 * boiler is destroyed or a boiler house is filled with carbon monoxide.
 */
const BOILER_IBR_ROWS = [
  "boiler_trip",
  "drum_level_low",
  "steam_pressure_high",
  "flue_o2_low",
] as const;

/**
 * `mechanical-boiler` against `docs/e5.2-derived-taglist-v1.md` §7 (plan §5.6) —
 * **the entry that closes the pack**, and the one that carries three things no
 * other entry does: the four process-chemistry rows with no `skill`, the four
 * statutory rows with no number, and the pack's one dual-tier row.
 */
function checkBoiler(): void {
  const entry = requireStockEntry(BOILER_CODE);
  assertEntryIdentity(BOILER_CODE, entry, "boiler", "mechanical");

  // ---- 25 points, 7 core + 14 extended + 2 manual + 2 derived -------------

  assert(
    tierCount(entry, "core") === 7 &&
      tierCount(entry, "extended") === 14 &&
      tierCount(entry, "manual") === 2 &&
      tierCount(entry, "derived") === 2,
    `§7 marks 7 rows C, 14 X (the dual-tier row included) and 2 M, and two of its five derived ` +
      `codes are authored — 7/14/2/2. Got ${tierCount(entry, "core")}/` +
      `${tierCount(entry, "extended")}/${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(BOILER_CODE, "§7", entry, BOILER_POINTS);
  assertDerivedPoints(BOILER_CODE, entry, BOILER_DERIVED);
  assertNoKpis(BOILER_CODE, entry, "§7");
  assertDeferralsAbsent(BOILER_CODE, entry);

  // ---- the pack's one dual-tier row, first-listed wins --------------------

  const feedwaterTds = entry.points.find((point) => point.pointKey === "feedwater_tds_ppm");
  assert(
    feedwaterTds?.meta?.tier === "extended" && feedwaterTds.required === false,
    `${BOILER_CODE}.feedwater_tds_ppm must be tier EXTENDED and optional. §7 spells its tier ` +
      "\"X/M\" — the pack's one dual-tier row — and ADR 0053 decision 4 resolves a dual-tier row " +
      "FIRST-LISTED WINS, as the water pack's two did. It is an online analyser on a plant that " +
      "has one and a laboratory sample on a plant that does not, and the document lists the " +
      "analyser first; meta.tier says what THAT plant type typically fits, not what the code is. " +
      "Reading it as manual would also make feedwater_tds_high an alarm on a row that can never " +
      `receive a value. Got tier ${String(feedwaterTds?.meta?.tier)}, required ` +
      `${String(feedwaterTds?.required)}.`,
  );

  // ---- the two M rows, and the one that strands blowdown_pct --------------

  for (const pointKey of ["boiler_water_ph", "blowdown_tds_ppm"]) {
    const lab = entry.points.find((point) => point.pointKey === pointKey);
    assert(
      lab?.meta?.tier === "manual" && lab.required === false && lab.sourceDataKeyPattern === null,
      `${BOILER_CODE}.${pointKey} must be one of the entry's two M rows — tier manual, optional, ` +
        "with a null sourceDataKeyPattern. §7 marks both \"(lab)\": a boiler-water pH and a " +
        "blowdown TDS are read on a bench and written on a log sheet, so they carry a null " +
        "pattern FOREVER, always land in skippedPoints and never get an asset_points row until " +
        "F1.8 manual entry gives them somewhere to write. blowdown_tds_ppm is also why " +
        "blowdown_pct is DEFERRED rather than authored: the TDS-balance formula parses over two " +
        "declared measured points, and one of them can never receive a value — the second " +
        `instance of water-softener's salt_efficiency_kg_kl class. Got tier ` +
        `${String(lab?.meta?.tier)}, required ${String(lab?.required)}, pattern ` +
        `${String(lab?.sourceDataKeyPattern)}.`,
    );
  }

  // ---- 11 alarms, four of them with no skill and four with no number ------

  const alarms = alarmsOf(entry);
  assertAlarmTable(BOILER_CODE, "§7", alarms, BOILER_ALARMS);
  assertPhilosophyRows(BOILER_CODE, alarms);
  assertSkillAssignment(
    BOILER_CODE,
    alarms,
    {
      boiler_trip: "mechanical",
      drum_level_low: "mechanical",
      // A level riding high is the feedwater control loop or the level
      // transmitter, not a mounting — the controls trade's, as the pump's and
      // the chiller's short-cycling rows are.
      drum_level_high: "controls",
      steam_pressure_high: "mechanical",
      // Demand beyond firing is the firing-rate control and the load, not a
      // failure of the pressure part.
      steam_pressure_low: "controls",
      flue_gas_temp_high: "mechanical",
      // A day tank and its bund are the civil trade's, as the water pack's tank
      // rows are.
      fuel_tank_level_low: "civil",
    },
    // THE PACK'S ONLY NO-SKILL ROWS, all four of them here. A combustion or a
    // water-chemistry excursion is answered by a process trade, and
    // bms.alarm_skills holds electrical, mechanical, hvac, controls and civil
    // and NO process (migration 0034; F4.78 files it). The field is omitted
    // rather than routed to a trade that does not answer the event — filing a
    // chemistry alarm under controls because a field wants a value is the
    // guessing the rule prevents. When F4.78 lands, these four gain a skill in
    // a stockVersion 2. assertSkillAssignment requires the map above and this
    // list to partition the eleven, so a misspelling here is a failure rather
    // than a row silently checked by nothing.
    ["flue_o2_high", "flue_o2_low", "co_high", "feedwater_tds_high"],
  );

  assertNoLimitNumbers(BOILER_CODE, alarms, BOILER_IBR_ROWS, IBR_REGIME);

  // ---- the day-tank row: one code, two spellings, and the reused key ------

  const fuelAlarm = alarms.find((alarm) => alarm.code === "fuel_tank_level_low");
  const fuelPoint = entry.points.find((point) => point.pointKey === "fuel_level_pct");
  assert(
    fuelAlarm?.pointKey === "fuel_level_pct" && fuelPoint !== undefined,
    `${BOILER_CODE}'s fuel_tank_level_low alarm must bind fuel_level_pct — THE DG SET'S CODE, ` +
      "reused. The alarm code and the point it binds disagree by name on purpose and this is not " +
      "a typo: §7 spells the row fuel_tank_level_pct, and plan §12 ruling 1 reused the DG set's " +
      "existing fuel_level_pct instead, because \"day-tank / bunker level\" and \"fuel level (day " +
      "tank)\" are one meaning and one meaning is one code (ADR 0051 Amendment 6 decision 5). The " +
      "tag list's spelling is corrected at closure rather than minted as a second key; a later " +
      "\"tidy\" of either name breaks the reuse and mints the duplicate the ruling refused. Got " +
      `"${String(fuelAlarm?.pointKey)}", point declared: ${String(fuelPoint !== undefined)}.`,
  );

  const splitRows = ["drum_level_pct", "steam_pressure_bar", "flue_o2_pct"] as const;
  for (const pointKey of splitRows) {
    assert(
      alarms.filter((alarm) => alarm.pointKey === pointKey).length === 2,
      `${BOILER_CODE} must carry two alarms on ${pointKey} at opposite bands. §7's bullets pair ` +
        "them — drum level low / high, steam pressure high / low, flue oxygen high / low — and a " +
        "band that is too low and a band that is too high are two different failures with two " +
        "different remedies, two different severities and, on this entry, two different skills. " +
        "Same shape as the pump's two current rows and the feeder's two voltage rows.",
    );
  }

  const safetyRows = alarms
    .filter((alarm) => alarm.category === "safety")
    .map((alarm) => alarm.code);
  assert(
    safetyRows.join(",") === "boiler_trip,drum_level_low,steam_pressure_high,flue_o2_low,co_high",
    `${BOILER_CODE} must file exactly boiler_trip, drum_level_low, steam_pressure_high, ` +
      "flue_o2_low and co_high as \"safety\" — the trip and the four ways a boiler hurts somebody: " +
      "uncovered tubes, a safety valve about to lift, incomplete combustion and the carbon " +
      "monoxide it makes. flue_gas_temp_high and flue_o2_high are \"energy\" (a machine still " +
      "making steam and spending more to do it) and the remaining four are \"operations\". Got " +
      `[${safetyRows.join(", ")}].`,
  );

  // ---- 5 maintenance plans: one safetyCritical, one compliance -----------

  const plans = maintenanceOf(entry);
  assert(plans.length === 5, `plan §5.7 authors 5 boiler plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 1 &&
      safetyCritical[0]?.category === "safety_critical" &&
      safetyCritical[0]?.priority === "critical" &&
      /low-water/i.test(String(safetyCritical[0]?.title)) &&
      String(safetyCritical[0]?.complianceRef) === "IBR log-sheet practice",
    `${BOILER_CODE} must carry exactly ONE safetyCritical plan — the low-water cut-off and ` +
      "safety-valve test, the third and last of the ADR 0053 decision 8 names for this pack " +
      "(the others are the compressor's relief-valve test and the AHU's fire-trip interlock " +
      "test). Those two devices are the barriers behind drum_level_low and steam_pressure_high, " +
      "the entry's two IBR-critical alarms, and a boiler is destroyed or bursts when they are the " +
      "things nobody tested. Category safety_critical, priority critical, complianceRef \"IBR " +
      `log-sheet practice\". Got ${safetyCritical.length}: ` +
      `${safetyCritical.map((plan) => plan.title).join("; ") || "(none)"}, complianceRef ` +
      `"${String(safetyCritical[0]?.complianceRef)}".`,
  );
  const compliance = plans.filter((plan) => plan.category === "compliance");
  assert(
    compliance.length === 1 &&
      compliance[0]?.safetyCritical === false &&
      compliance[0]?.priority === "critical" &&
      String(compliance[0]?.complianceRef) === "IBR annual inspection",
    `${BOILER_CODE}'s annual inspection preparation must be category "compliance" with ` +
      "safetyCritical FALSE and complianceRef \"IBR annual inspection\" (plan §12 ruling 5). It " +
      "is a statutory inspection with its own reference and its own consequence — a boiler " +
      "without a current certificate may not be fired — and that is a compliance item rather " +
      "than a life-safety barrier. Authoring it safetyCritical would make four such plans in a " +
      "pack ADR 0053 decision 8 says has three, and would blur the two meanings: one is a device " +
      "that stops an accident, the other is a document that permits operation. Its priority is " +
      `still critical. Got ${compliance.length} compliance plan(s), safetyCritical ` +
      `${String(compliance[0]?.safetyCritical)}, complianceRef ` +
      `"${String(compliance[0]?.complianceRef)}".`,
  );
  // NO condition_based plan on this entry: a boiler's schedule is the statute's
  // and the water treatment's, not a measured value crossing a band. The
  // chemistry round is inspection_round on a weekly calendar because the log
  // sheet is what the inspector reads, and the two rows it records are M rows
  // that no condition could ever be evaluated against.
  const conditionPlans = plans.filter((plan) => plan.category === "condition_based");
  assert(
    conditionPlans.length === 0,
    `${BOILER_CODE} must carry NO condition_based plan — a boiler's schedule is the statute's and ` +
      "the water treatment's rather than a measured value crossing a band, and the two rows the " +
      "chemistry round records are M rows nothing could evaluate a condition against. Got " +
      `${conditionPlans.length}: ${conditionPlans.map((plan) => plan.title).join("; ")}.`,
  );
  const chemistry = plans.find((plan) => plan.category === "inspection_round");
  const chemistryTrigger = String(chemistry?.triggerSummary ?? "");
  for (const pointKey of ["boiler_water_ph", "blowdown_tds_ppm"]) {
    assert(
      chemistryTrigger.includes(pointKey),
      `${BOILER_CODE}'s blowdown and chemistry round must name ${pointKey} in its triggerSummary ` +
        "— the entry's two M rows, and this plan is the only thing that produces their values at " +
        `all. Got: "${chemistryTrigger}"`,
    );
  }
  const burner = plans.find((plan) => /burner/i.test(String(plan.title)));
  const burnerTrigger = String(burner?.triggerSummary ?? "");
  for (const pointKey of ["flue_o2_pct", "flue_co_ppm"]) {
    assert(
      burnerTrigger.includes(pointKey),
      `${BOILER_CODE}'s burner service and combustion tuning plan must name ${pointKey} in its ` +
        "triggerSummary — the two readings the tuning is done against, and the two the four " +
        `no-skill process rows are bound to. Got: "${burnerTrigger}"`,
    );
  }
  assertMaintenanceBounds(BOILER_CODE, entry);
  assertProvenance(BOILER_CODE, entry, MECHANICAL_TAG_LIST, "§7");
}

/**
 * Every per-class block in this file. Called by `mechanical-classes-3.test.ts`,
 * its name-sibling wrapper. **§1 to §4 live in `mechanical-classes.spec.ts` and
 * `-2`** — two entries per file, so no file in this directory approaches the
 * §4.5 cap.
 */
export function runMechanicalClassEntryTests3(): void {
  checkAhu();
  checkBoiler();
}
