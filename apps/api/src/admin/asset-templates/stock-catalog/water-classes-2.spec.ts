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
} from "./water-classes.spec";

/**
 * `E5.1` pass C, the second of three transcription spec files — §4 (cooling
 * tower) and §1 (WTP) of `docs/e5.1-derived-taglist-v1.md`.
 *
 * **The shared half is imported from `water-classes.spec.ts`, not restated.**
 * The `0034` skill parser, the point and alarm transcription tables, the
 * philosophy and skill assertions, the maintenance bounds, the deferral loop
 * and the provenance needles are pack-wide properties, so they live once in the
 * first file and are exported — the shape `electrical-classes-2.spec.ts`
 * already uses against `stock-catalog.spec.ts`. **Not a plain helper `.ts`**: a
 * bare module in this directory would need a `STOCK_ASSET_RELS` entry in
 * `tests/f2.13-asset-stock-catalog-vocabulary.test.ts` (moving that count off
 * 16), while a helpers-only `.spec.ts` would need a wrapper that runs nothing.
 *
 * **Three files and not two, decided at plan §3's first escalation
 * checkpoint.** `water-classes.spec.ts` reached 704 lines with two entries in
 * it; the cooling tower's block alone carries four exact formula strings and an
 * override, and the plan's original three-plus-three split projected past the
 * §4.5 1000-line cap by this task. Two entries per file is the measured cap.
 *
 * **`water-classes-2.test.ts` is this file's name-sibling wrapper** —
 * `tests/repo-invariants.test.ts` matches the pair by name, and a spec imported
 * from a differently-named wrapper still runs but is absent from coverage.
 */

// ===========================================================================
// §4 — `water-cooling-tower`
// ===========================================================================

const TOWER_CODE = "water-cooling-tower";

/**
 * §4's 17 table rows in the document's own order, then the four authored
 * derived codes appended at `sortOrder` 17-20 — `[pointKey, tier, unit]`.
 *
 * `cycles_of_concentration` carries `null`: it is a dimensionless ratio, which
 * `UNIT_BY_KEY` spells `""` the way it already spells `pf`, and a template
 * `unit` of `null` defers to the catalog rather than overriding it.
 */
const TOWER_POINTS: readonly PointRow[] = [
  ["supply_temp_c", "core", "°C"],
  ["return_temp_c", "core", "°C"],
  ["ambient_wetbulb_c", "extended", "°C"],
  ["circ_flow_klh", "core", "KL/hr"],
  ["makeup_flow_klh", "core", "KL/hr"],
  ["blowdown_flow_klh", "extended", "KL/hr"],
  ["basin_level_pct", "core", "%"],
  ["circ_conductivity_uscm", "core", "µS/cm"],
  ["makeup_conductivity_uscm", "extended", "µS/cm"],
  ["circ_ph", "core", "pH"],
  ["circ_orp_mv", "extended", "mV"],
  ["fan_status", "core", null],
  ["fan_current_a", "extended", "A"],
  ["circ_pump_status", "core", null],
  ["circ_pump_current_a", "core", "A"],
  ["inhibitor_dose_lph", "extended", "L/hr"],
  ["circ_tds_mgl", "manual", "mg/L"],
  ["range_c", "derived", "°C"],
  ["approach_c", "derived", "°C"],
  ["cycles_of_concentration", "derived", null],
  ["makeup_pct", "derived", "%"],
];

/**
 * The four formulas of plan §5.0, and the row's **one**
 * `maxInputAgeSeconds` override.
 *
 * `approach_c` takes 3600 s and not the 300 s default because
 * `ambient_wetbulb_c` commonly comes from a site weather station rather than
 * the tower controller — the same call `F2.12` made for
 * `oil_rise_over_ambient_c`. The other three take both inputs from the same
 * controller at the same scan rate and keep the default, spelled `null`.
 */
const TOWER_DERIVED: readonly DerivedRow[] = [
  ["range_c", "{return_temp_c} - {supply_temp_c}", null],
  ["approach_c", "{supply_temp_c} - {ambient_wetbulb_c}", 3600],
  ["cycles_of_concentration", "{circ_conductivity_uscm} / {makeup_conductivity_uscm}", null],
  ["makeup_pct", "{makeup_flow_klh} / {circ_flow_klh} * 100", null],
];

/**
 * §4's five alarm bullets become **seven** rows: *"cycles low / high"* splits
 * into two (two opposite meanings — water waste and scaling risk) and
 * *"fan/pump trip"* splits into two (two machines, two responses).
 */
const TOWER_ALARMS: readonly AlarmRow[] = [
  ["approach_high", "approach_c", "warning", "energy"],
  ["cycles_low", "cycles_of_concentration", "info", "energy"],
  ["cycles_high", "cycles_of_concentration", "warning", "operations"],
  ["ph_out_of_program_band", "circ_ph", "warning", "operations"],
  ["basin_level_low", "basin_level_pct", "critical", "operations"],
  ["fan_trip", "fan_status", "warning", "operations"],
  ["circ_pump_trip", "circ_pump_status", "critical", "operations"],
];

/**
 * `water-cooling-tower` against `docs/e5.1-derived-taglist-v1.md` §4 (plan
 * §5.3). **The entry the derived machinery is first proved on**, and plan §3's
 * second escalation checkpoint keys on it: four formulas, one
 * `maxInputAgeSeconds` override, and the first two alarms in the pack that bind
 * a derived point rather than a measured one.
 */
function checkCoolingTower(): void {
  const entry = requireStockEntry(TOWER_CODE);
  assertEntryIdentity(TOWER_CODE, entry, "cooling_tower");

  // ---- 21 points, 10 core + 6 extended + 1 manual + 4 derived -------------

  assert(
    tierCount(entry, "core") === 10 &&
      tierCount(entry, "extended") === 6 &&
      tierCount(entry, "manual") === 1 &&
      tierCount(entry, "derived") === 4,
    `§4 marks 10 rows C, 6 X and 1 M, and four of its five derived codes are authored — ` +
      `10/6/1/4. Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(TOWER_CODE, "§4", entry, TOWER_POINTS);
  assertDerivedPoints(TOWER_CODE, entry, TOWER_DERIVED);
  assertNoKpis(TOWER_CODE, entry, "§4");
  assertDeferralsAbsent(TOWER_CODE, entry);

  // ---- two formulas legally reference an X-tier input ---------------------

  const optionalInputs = ["ambient_wetbulb_c", "makeup_conductivity_uscm"];
  for (const pointKey of optionalInputs) {
    const point = entry.points.find((row) => row.pointKey === pointKey);
    assert(
      point?.meta?.tier === "extended" && point.required === false,
      `${TOWER_CODE}.${pointKey} must stay tier X and optional. approach_c and ` +
        "cycles_of_concentration each reference it, and that is LEGAL — the reference check " +
        "requires the key to be DECLARED, not required (ADR 0036 decision 7) — so a site that " +
        "does not fit the probe simply gets no value for that derived point. Do not \"fix\" the " +
        `formula by promoting its input to C. Got tier ${String(point?.meta?.tier)}, required ` +
        `${String(point?.required)}.`,
    );
  }

  // ---- 7 alarms, two of them binding a derived point ----------------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(TOWER_CODE, "§4", alarms, TOWER_ALARMS);
  assertPhilosophyRows(TOWER_CODE, alarms);
  assertSkillAssignment(
    TOWER_CODE,
    alarms,
    {
      approach_high: "mechanical",
      cycles_low: "controls",
      basin_level_low: "civil",
      fan_trip: "mechanical",
      circ_pump_trip: "mechanical",
    },
    ["cycles_high", "ph_out_of_program_band"],
  );

  const derivedBound = alarms.filter((alarm) =>
    ["approach_c", "cycles_of_concentration"].includes(alarm.pointKey),
  );
  assert(
    derivedBound.length === 3,
    `${TOWER_CODE} must bind a DERIVED point from three alarms — approach_high on approach_c, and ` +
      `both cycles rows on cycles_of_concentration. That is why those two are POINTS and not ` +
      `KPIs: a content.kpis entry cannot be bound by an alarm, and an alarm may only reference a ` +
      `key the template declares. Got ${derivedBound.length}.`,
  );
  assert(
    alarms.filter((alarm) => alarm.pointKey === "cycles_of_concentration").length === 2,
    `${TOWER_CODE} must carry two alarms on cycles_of_concentration at opposite bands — low is ` +
      "water waste and high is scaling risk, exactly as the feeder binds voltage_vry twice for " +
      "under- and over-voltage. Different meanings at different bands are different rows.",
  );

  // ---- 4 maintenance plans, the Legionella program the critical one -------

  const plans = maintenanceOf(entry);
  assert(plans.length === 4, `plan §5.7 authors 4 cooling tower plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 1,
    `exactly one §4 plan is safetyCritical — the biocide program and Legionella sampling; got ` +
      `${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join("; ") || "(none)"}`,
  );
  const biocide = safetyCritical[0];
  assert(
    typeof biocide?.title === "string" && biocide.title.includes("Legionella"),
    "the one safetyCritical cooling tower plan must be the biocide program dose check and " +
      "Legionella sampling — a cooling tower is an aerosol generator, and Legionella control is " +
      `the reason this plan and not the fan service is the critical one. Got: "${String(biocide?.title)}"`,
  );
  assert(
    biocide?.category === "safety_critical",
    `the Legionella plan must be category "safety_critical"; got "${String(biocide?.category)}"`,
  );
  assertMaintenanceBounds(TOWER_CODE, entry);
  assertProvenance(TOWER_CODE, entry, "§4");
}

// ===========================================================================
// §1 — `water-wtp`
// ===========================================================================

const WTP_CODE = "water-wtp";

/**
 * §1's 18 table rows in the document's own order, then the two authored
 * derived codes at `sortOrder` 18-19 — `[pointKey, tier, unit]`.
 *
 * `raw_color_hazen` carries `Hazen` and not `null`: plan §12 ruling 3 keeps
 * `pH`, `Hazen` and `SDI15` as named units, because ADR 0051 Amendment 6
 * decision 4 maps only *0/1, enum, code, tap and count* rows to the empty
 * string and these three are named scales an operator reads.
 */
const WTP_POINTS: readonly PointRow[] = [
  ["raw_water_flow_klh", "core", "KL/hr"],
  ["raw_turbidity_ntu", "core", "NTU"],
  ["raw_ph", "core", "pH"],
  ["settled_turbidity_ntu", "extended", "NTU"],
  ["filtered_turbidity_ntu", "core", "NTU"],
  ["filter_dp_bar", "core", "bar"],
  ["backwash_status", "core", null],
  ["coagulant_dose_lph", "extended", "L/hr"],
  ["chlorine_dose_lph", "extended", "L/hr"],
  ["treated_cl2_residual_mgl", "core", "mg/L"],
  ["treated_water_flow_klh", "core", "KL/hr"],
  ["clearwell_level_pct", "core", "%"],
  ["clarifier_sludge_level_pct", "extended", "%"],
  ["treated_conductivity_uscm", "extended", "µS/cm"],
  ["intake_pump_current_a", "core", "A"],
  ["intake_pump_status", "core", null],
  ["raw_color_hazen", "manual", "Hazen"],
  ["raw_alkalinity_mgl", "manual", "mg/L"],
  ["recovery_pct", "derived", "%"],
  ["turbidity_removal_pct", "derived", "%"],
];

/**
 * §1's two expressible derived codes. Both take their inputs from the same
 * controller at the same scan rate, so both keep the 300 s default, spelled
 * `null` — there is no `approach_c`-shaped override on this entry.
 */
const WTP_DERIVED: readonly DerivedRow[] = [
  ["recovery_pct", "{treated_water_flow_klh} / {raw_water_flow_klh} * 100", null],
  [
    "turbidity_removal_pct",
    "(1 - {filtered_turbidity_ntu} / {raw_turbidity_ntu}) * 100",
    null,
  ],
];

/**
 * §1's five alarm bullets become **six** rows: *"residual chlorine low /
 * high"* splits into two, which are opposite failures — a disinfection failure
 * and an overdose — bound to one point at two bands.
 */
const WTP_ALARMS: readonly AlarmRow[] = [
  ["filtered_turbidity_high", "filtered_turbidity_ntu", "critical", "safety"],
  ["chlorine_residual_low", "treated_cl2_residual_mgl", "critical", "safety"],
  ["chlorine_residual_high", "treated_cl2_residual_mgl", "warning", "operations"],
  ["filter_dp_high", "filter_dp_bar", "warning", "operations"],
  ["clearwell_level_low", "clearwell_level_pct", "critical", "operations"],
  ["intake_pump_trip", "intake_pump_status", "critical", "operations"],
];

/**
 * `water-wtp` against `docs/e5.1-derived-taglist-v1.md` §1 (plan §5.4) — the
 * potable-side entry, and the first of the two that author `recovery_pct`.
 */
function checkWtp(): void {
  const entry = requireStockEntry(WTP_CODE);
  assertEntryIdentity(WTP_CODE, entry, "wtp");

  // ---- 20 points, 11 core + 5 extended + 2 manual + 2 derived -------------

  assert(
    tierCount(entry, "core") === 11 &&
      tierCount(entry, "extended") === 5 &&
      tierCount(entry, "manual") === 2 &&
      tierCount(entry, "derived") === 2,
    `§1 marks 11 rows C, 5 X and 2 M, and two of its three derived codes are authored — ` +
      `11/5/2/2. Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(WTP_CODE, "§1", entry, WTP_POINTS);
  assertDerivedPoints(WTP_CODE, entry, WTP_DERIVED);
  assertNoKpis(WTP_CODE, entry, "§1");
  assertDeferralsAbsent(WTP_CODE, entry);

  // ---- the spelling the tag list does not use ----------------------------

  assert(
    !entry.points.some((point) => point.pointKey === "pct_recovery"),
    `${WTP_CODE} declares pct_recovery, which is the TAG LIST's spelling and not the code's. ` +
      "Plan §12 ruling 1 ruled recovery_pct: ADR 0040 decision 2's convention is snake_case plus " +
      "a unit suffix, and every other percentage in the vocabulary is *_pct. The document's two " +
      "D rows are corrected in the closure docs PR so the handout and the product agree at the " +
      "moment a client reads both. The code is seeded write-once into bms.point_keys, so this is " +
      "the spelling that is permanent.",
  );

  // ---- 6 alarms, two of them on one point at opposite bands ---------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(WTP_CODE, "§1", alarms, WTP_ALARMS);
  assertPhilosophyRows(WTP_CODE, alarms);
  assertSkillAssignment(
    WTP_CODE,
    alarms,
    {
      chlorine_residual_low: "controls",
      chlorine_residual_high: "controls",
      filter_dp_high: "mechanical",
      clearwell_level_low: "civil",
      intake_pump_trip: "mechanical",
    },
    ["filtered_turbidity_high"],
  );
  assert(
    alarms.filter((alarm) => alarm.pointKey === "treated_cl2_residual_mgl").length === 2,
    `${WTP_CODE} must carry two alarms on treated_cl2_residual_mgl at opposite bands — low is a ` +
      "disinfection failure and high is an overdose with its own taste, odour and by-product " +
      "consequences. Same shape as the cooling tower's two cycles rows and the feeder's two " +
      "voltage rows: different meanings at different bands are different rows.",
  );

  // ---- 4 maintenance plans, the chlorine service the critical one ---------

  const plans = maintenanceOf(entry);
  assert(plans.length === 4, `plan §5.7 authors 4 WTP maintenance plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 1,
    `exactly one §1 plan is safetyCritical — the chlorine dosing service and residual analyser ` +
      `calibration; got ${safetyCritical.length}: ` +
      `${safetyCritical.map((plan) => plan.title).join("; ") || "(none)"}`,
  );
  const chlorine = safetyCritical[0];
  assert(
    typeof chlorine?.title === "string" && chlorine.title.includes("Chlorine dosing"),
    "the one safetyCritical WTP plan must be the chlorine dosing service and residual analyser " +
      "calibration — disinfection is the public-health barrier this entry exists to keep proven, " +
      `and it is the barrier the two residual alarms report on. Got: "${String(chlorine?.title)}"`,
  );
  assert(
    chlorine?.category === "safety_critical",
    `the chlorine dosing plan must be category "safety_critical"; got "${String(chlorine?.category)}"`,
  );
  assertMaintenanceBounds(WTP_CODE, entry);
  assertProvenance(WTP_CODE, entry, "§1");
}

/**
 * Every per-class block in this file. Called by `water-classes-2.test.ts`, its
 * name-sibling wrapper.
 */
export function runWaterClassEntryTests2(): void {
  checkCoolingTower();
  checkWtp();
}
