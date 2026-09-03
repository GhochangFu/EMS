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
import { WATER_TAG_LIST } from "./water-classes.spec";

/**
 * `E5.1` pass C, the third of three transcription spec files — §2 (RO skid)
 * and §3 (softener) of `docs/e5.1-derived-taglist-v1.md`.
 *
 * **The transcription helpers are imported from `stock-transcription.spec.ts`,
 * not restated** — see `water-classes-2.spec.ts`'s docblock for why they left
 * `water-classes.spec.ts` in `E5.2` Task 2 and why they are a `.spec.ts` with
 * self-tests rather than a plain module (a bare `.ts` here would need a
 * `STOCK_ASSET_RELS` entry in `tests/f2.13`; a helpers-only `.spec.ts` would
 * need a wrapper that runs nothing). `WATER_TAG_LIST` is still this pack's and
 * still comes from `water-classes.spec.ts`.
 *
 * **`water-classes-3.test.ts` is this file's name-sibling wrapper** —
 * `tests/repo-invariants.test.ts` matches the pair by name, and a spec imported
 * from a differently-named wrapper still runs but is absent from coverage.
 */

// ===========================================================================
// §2 — `water-ro`
// ===========================================================================

const RO_CODE = "water-ro";

/**
 * §2's 16 table rows in the document's own order, then the two authored
 * derived codes at `sortOrder` 16-17 — `[pointKey, tier, unit]`.
 *
 * `feed_sdi` carries `SDI15` and not `null`: plan §12 ruling 3 keeps `pH`,
 * `Hazen` and `SDI15` as named units, because ADR 0051 Amendment 6 decision 4
 * maps only *0/1, enum, code, tap and count* rows to the empty string and these
 * three are named scales an operator reads.
 */
const RO_POINTS: readonly PointRow[] = [
  ["feed_flow_klh", "core", "KL/hr"],
  ["permeate_flow_klh", "core", "KL/hr"],
  ["reject_flow_klh", "core", "KL/hr"],
  ["feed_pressure_bar", "core", "bar"],
  ["stage1_dp_bar", "extended", "bar"],
  ["feed_conductivity_uscm", "core", "µS/cm"],
  ["permeate_conductivity_uscm", "core", "µS/cm"],
  ["feed_ph", "core", "pH"],
  ["feed_orp_mv", "extended", "mV"],
  ["feed_temp_c", "core", "°C"],
  ["hp_pump_current_a", "core", "A"],
  ["hp_pump_status", "core", null],
  ["cip_status", "extended", null],
  ["antiscalant_dose_lph", "extended", "L/hr"],
  ["feed_sdi", "manual", "SDI15"],
  ["cartridge_filter_dp_bar", "extended", "bar"],
  ["recovery_pct", "derived", "%"],
  ["salt_rejection_pct", "derived", "%"],
];

/** §2's two expressible derived codes. Both keep the 300 s default. */
const RO_DERIVED: readonly DerivedRow[] = [
  ["recovery_pct", "{permeate_flow_klh} / {feed_flow_klh} * 100", null],
  [
    "salt_rejection_pct",
    "(1 - {permeate_conductivity_uscm} / {feed_conductivity_uscm}) * 100",
    null,
  ],
];

/** §2's six alarm bullets, one row each — nothing splits on this entry. */
const RO_ALARMS: readonly AlarmRow[] = [
  ["permeate_conductivity_high", "permeate_conductivity_uscm", "critical", "operations"],
  ["recovery_low", "recovery_pct", "warning", "operations"],
  ["stage_dp_high", "stage1_dp_bar", "warning", "operations"],
  ["feed_orp_high", "feed_orp_mv", "critical", "safety"],
  ["hp_pump_trip", "hp_pump_status", "critical", "operations"],
  ["sdi_high", "feed_sdi", "warning", "operations"],
];

/**
 * **`recovery_pct` is ONE code authored on TWO entries with DIFFERENT formula
 * strings, and that is correct rather than a clash.**
 *
 * ADR 0051 Amendment 6 decision 5 rules one code, one *meaning* — and the
 * meaning is identical on both plants: *the fraction of the input stream that
 * leaves as product*. Only the input names differ, exactly as `load_pct` means
 * the same thing on four electrical classes. The code is promoted **once** into
 * `WATER_CLASS_POINT_KEYS` and authored **twice**, which is why `tests/f2.13`
 * counts 103 declared point rows over 98 distinct keys.
 *
 * Asserted from this block rather than from the WTP's because this is the
 * second authoring — the one a reader arrives at already holding the first, and
 * therefore the one where the suspicion of a copy-paste bug lands.
 */
function assertRecoveryIsOneCodeTwoFormulas(): void {
  const formulaOn = (code: string): string | undefined =>
    requireStockEntry(code).points.find((point) => point.pointKey === "recovery_pct")?.formula ??
    undefined;
  const wtp = formulaOn("water-wtp");
  const ro = formulaOn("water-ro");
  assert(
    wtp === "{treated_water_flow_klh} / {raw_water_flow_klh} * 100" &&
      ro === "{permeate_flow_klh} / {feed_flow_klh} * 100",
    "recovery_pct must be authored on BOTH water-wtp and water-ro, each over its own plant's " +
      `inlet and product streams. Got WTP "${String(wtp)}" and RO "${String(ro)}". One code, one ` +
      "MEANING (ADR 0051 Amendment 6 decision 5) — the fraction of the input stream that leaves " +
      "as product — and two formulas, because the inputs are named differently on the two " +
      "plants. This is not a clash and must not be \"fixed\" by minting a second code.",
  );
  assert(
    wtp !== ro,
    "the two recovery_pct formulas must differ — identical strings mean one of the two entries " +
      "was copied from the other and now computes the wrong plant's recovery",
  );
}

/**
 * `water-ro` against `docs/e5.1-derived-taglist-v1.md` §2 (plan §5.5).
 * `assetType` is **`ro_skid`**, the repository's existing spelling — the
 * `asset-templates.instantiate.integration.spec.ts` fixtures already use it
 * beside `feeder`, `test_rig` and `test_skid`, confirmed by plan §12 ruling 4.
 */
function checkRo(): void {
  const entry = requireStockEntry(RO_CODE);
  assertEntryIdentity(RO_CODE, entry, "ro_skid", "water");

  // ---- 18 points, 10 core + 5 extended + 1 manual + 2 derived -------------

  assert(
    tierCount(entry, "core") === 10 &&
      tierCount(entry, "extended") === 5 &&
      tierCount(entry, "manual") === 1 &&
      tierCount(entry, "derived") === 2,
    `§2 marks 10 rows C, 5 X and 1 M, and two of its four derived codes are authored — 10/5/1/2. ` +
      `Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(RO_CODE, "§2", entry, RO_POINTS);
  assertDerivedPoints(RO_CODE, entry, RO_DERIVED);
  assertRecoveryIsOneCodeTwoFormulas();
  assertNoKpis(RO_CODE, entry, "§2");
  assertDeferralsAbsent(RO_CODE, entry);

  // ---- 6 alarms, one on a derived point and one on an M row ---------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(RO_CODE, "§2", alarms, RO_ALARMS);
  assertPhilosophyRows(RO_CODE, alarms);
  assertSkillAssignment(
    RO_CODE,
    alarms,
    {
      permeate_conductivity_high: "mechanical",
      stage_dp_high: "mechanical",
      hp_pump_trip: "mechanical",
      feed_orp_high: "controls",
    },
    ["recovery_low", "sdi_high"],
  );

  const recoveryLow = alarms.find((alarm) => alarm.code === "recovery_low");
  const recoveryPoint = entry.points.find((point) => point.pointKey === "recovery_pct");
  assert(
    recoveryLow?.pointKey === "recovery_pct" && recoveryPoint?.kind === "derived",
    `${RO_CODE}'s recovery_low alarm must bind the DERIVED point recovery_pct. That binding is ` +
      "why recovery is a point and not a content.kpis entry: a KPI cannot be bound by an alarm, " +
      `and an alarm may only reference a key the template declares. Got ` +
      `"${String(recoveryLow?.pointKey)}" on a "${String(recoveryPoint?.kind)}" point.`,
  );

  const sdiHigh = alarms.find((alarm) => alarm.code === "sdi_high");
  const sdiPoint = entry.points.find((point) => point.pointKey === "feed_sdi");
  assert(
    sdiHigh?.pointKey === "feed_sdi" && sdiPoint?.meta?.tier === "manual",
    `${RO_CODE}'s sdi_high alarm must bind feed_sdi, an M row — and that is LEGAL: ` +
      "assertContentRefsResolve requires the key to be DECLARED, not required, and not measured " +
      "online. The silt density index is a manual test, so the alarm fires on a value F1.8 " +
      `manual entry writes. Got "${String(sdiHigh?.pointKey)}" on tier ` +
      `"${String(sdiPoint?.meta?.tier)}".`,
  );

  const alarmedKeys = new Set(alarms.map((alarm) => alarm.pointKey));
  assert(
    entry.points.some((point) => point.pointKey === "cartridge_filter_dp_bar") &&
      !alarmedKeys.has("cartridge_filter_dp_bar"),
    `${RO_CODE} must DECLARE cartridge_filter_dp_bar and give it NO alarm. §2's "stage ΔP high" ` +
      "bullet is singular and names the membrane stage, so the cartridge pre-filter gets a " +
      "maintenance plan rather than an invented alarm row. The gap is a decision, not an " +
      "omission — see the module docblock.",
  );

  // ---- 4 maintenance plans, none of them safety-critical ------------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 4, `plan §5.7 authors 4 RO maintenance plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 0,
    `no RO plan is safetyCritical — the pack's three are the ETP guard pond, the cooling tower ` +
      `Legionella program and the WTP chlorine dosing service (plan §5.7). Got ` +
      `${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join("; ")}`,
  );
  const cip = plans.find((plan) => plan.category === "condition_based");
  assert(
    cip !== undefined && cip.generationMode === "condition",
    `${RO_CODE} must carry exactly one condition_based plan generated in "condition" mode — the ` +
      "membrane clean-in-place, which is due when stage differential pressure rises or permeate " +
      "quality falls, not on a date. Asserting the pair and not just the category is deliberate: " +
      `a category with a calendar generationMode is a condition plan in name only. Got category ` +
      `${String(cip?.category)} / generationMode ${String(cip?.generationMode)}.`,
  );
  assert(
    typeof cip?.triggerSummary === "string" && cip.triggerSummary.includes("stage1_dp_bar"),
    `${RO_CODE}'s condition_based plan must name stage1_dp_bar in its triggerSummary — the point ` +
      "the stage_dp_high alarm binds is the condition the plan is scheduled on, and nothing else " +
      "in the entry records which point that is",
  );
  assertMaintenanceBounds(RO_CODE, entry);
  assertProvenance(RO_CODE, entry, WATER_TAG_LIST, "§2");
}

// ===========================================================================
// §3 — `water-softener`
// ===========================================================================

const SOFTENER_CODE = "water-softener";

/**
 * §3's 9 table rows in the document's own order — `[pointKey, tier, unit]`. No
 * derived code is authored: all three of §3's are deferred.
 *
 * The smallest entry in the pack, and the cheap opposite end that proves the
 * mechanism is not tuned to one shape.
 */
const SOFTENER_POINTS: readonly PointRow[] = [
  ["inlet_flow_klh", "core", "KL/hr"],
  ["outlet_flow_totalizer_kl", "core", "KL"],
  ["outlet_hardness_mgl", "extended", "mg/L"],
  ["inlet_hardness_mgl", "manual", "mg/L"],
  ["vessel_dp_bar", "extended", "bar"],
  ["regen_status", "core", null],
  ["brine_tank_level_pct", "core", "%"],
  ["salt_consumption_kg", "manual", "kg"],
  ["outlet_conductivity_uscm", "extended", "µS/cm"],
];

/** §3's four alarm bullets, one row each — nothing splits on this entry. */
const SOFTENER_ALARMS: readonly AlarmRow[] = [
  ["outlet_hardness_high", "outlet_hardness_mgl", "critical", "operations"],
  ["brine_level_low", "brine_tank_level_pct", "warning", "operations"],
  ["vessel_dp_high", "vessel_dp_bar", "warning", "operations"],
  ["throughput_anomaly", "outlet_flow_totalizer_kl", "info", "operations"],
];

/**
 * `water-softener` against `docs/e5.1-derived-taglist-v1.md` §3 (plan §5.6) —
 * the last entry of the pack, and the one whose deferral ledger is worth
 * reading: `salt_efficiency_kg_kl`'s formula PARSES and its point could never
 * fire.
 */
function checkSoftener(): void {
  const entry = requireStockEntry(SOFTENER_CODE);
  assertEntryIdentity(SOFTENER_CODE, entry, "softener", "water");

  // ---- 9 points, 4 core + 3 extended + 2 manual + 0 derived ---------------

  assert(
    tierCount(entry, "core") === 4 &&
      tierCount(entry, "extended") === 3 &&
      tierCount(entry, "manual") === 2 &&
      tierCount(entry, "derived") === 0,
    `§3 marks 4 rows C, 3 X and 2 M, and all three of its derived codes are deferred — 4/3/2/0. ` +
      `Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(SOFTENER_CODE, "§3", entry, SOFTENER_POINTS);
  assertNoKpis(SOFTENER_CODE, entry, "§3");
  assertDeferralsAbsent(SOFTENER_CODE, entry);

  // ---- the deferral whose reason is the data model, not the grammar -------

  const keys = new Set(entry.points.map((point) => point.pointKey));
  assert(
    keys.has("salt_consumption_kg") &&
      keys.has("outlet_flow_totalizer_kl") &&
      !keys.has("salt_efficiency_kg_kl"),
    `${SOFTENER_CODE} must declare both of salt_efficiency_kg_kl's inputs and NOT author the code ` +
      "itself. This is the one deferral in the whole catalog whose reason is the DATA MODEL " +
      "rather than the grammar: {salt_consumption_kg} / {outlet_flow_totalizer_kl} is valid " +
      "bms-calc-v1 over two declared measured points, and the point could never fire, because " +
      "salt_consumption_kg is an M row whose sourceDataKeyPattern is null forever — planAsset " +
      "puts it in skippedPoints, so it never gets an asset_points row, never gets a reading, and " +
      "the formula never has an input. A permanent, 0058-foreign-keyed point key for a formula " +
      "that cannot run is the decorative vocabulary ADR 0051 fact 4 exists to end. It becomes " +
      "authorable the day F1.8 gives a manual row somewhere to write to.",
  );
  assert(
    !keys.has("throughput_since_regen_kl"),
    `${SOFTENER_CODE} declares throughput_since_regen_kl, and it must not: §3 ALREADY carries ` +
      'that quantity as the MEASURED row outlet_flow_totalizer_kl — "Treated volume since ' +
      'regeneration". A derived restatement of a declared point adds nothing and would be a ' +
      "second code for one meaning, which ADR 0051 Amendment 6 decision 5 refuses.",
  );

  // ---- 4 alarms -----------------------------------------------------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(SOFTENER_CODE, "§3", alarms, SOFTENER_ALARMS);
  assertPhilosophyRows(SOFTENER_CODE, alarms);
  assertSkillAssignment(
    SOFTENER_CODE,
    alarms,
    { brine_level_low: "civil", vessel_dp_high: "mechanical" },
    ["outlet_hardness_high", "throughput_anomaly"],
  );

  const throughput = alarms.find((alarm) => alarm.code === "throughput_anomaly");
  assert(
    throughput?.pointKey === "outlet_flow_totalizer_kl",
    `${SOFTENER_CODE}'s throughput_anomaly alarm must bind outlet_flow_totalizer_kl. The ` +
      "comparison it implies is against the vessel's RATED exchange capacity, which is an asset " +
      "attribute — so the comparison is per site and set at commissioning, which is exactly why " +
      `this row carries a parameter and no number. Got "${String(throughput?.pointKey)}".`,
  );

  // ---- 3 maintenance plans, none of them safety-critical ------------------

  const plans = maintenanceOf(entry);
  assert(
    plans.length === 3,
    `plan §5.7 authors 3 softener maintenance plans — the pack's only entry with three; the ` +
      `entry carries ${plans.length}`,
  );
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 0,
    `no softener plan is safetyCritical — the pack's three are the ETP guard pond, the cooling ` +
      `tower Legionella program and the WTP chlorine dosing service (plan §5.7). Got ` +
      `${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join("; ")}`,
  );
  assertMaintenanceBounds(SOFTENER_CODE, entry);
  assertProvenance(SOFTENER_CODE, entry, WATER_TAG_LIST, "§3");
}

/**
 * Every per-class block in this file. Called by `water-classes-3.test.ts`, its
 * name-sibling wrapper.
 */
export function runWaterClassEntryTests3(): void {
  checkRo();
  checkSoftener();
}
