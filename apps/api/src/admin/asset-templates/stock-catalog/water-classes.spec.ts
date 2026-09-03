import { alarmsOf, assert, maintenanceOf, requireStockEntry } from "./stock-catalog.spec";
import {
  assertAlarmTable,
  assertDeferralsAbsent,
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
  type PointRow,
} from "./stock-transcription.spec";

/**
 * `E5.1` pass C — one block per water plant class, each assertion a claim about
 * `docs/e5.1-derived-taglist-v1.md` rather than about the code. If the tag list
 * changes, these change with it, in the same PR.
 *
 * **Three sibling files rather than more of `stock-catalog.spec.ts`.** The cut
 * is `F2.12`'s and it is by *kind*: `stock-catalog.spec.ts` holds the
 * mechanism's claims — `checkEntry`, run over every catalog entry and over the
 * inline fixtures — and these files hold the transcription claims, one block
 * per tag-list section. **Two entries per file, because two proved to be the
 * cap**: the STP block alone is ~150 lines, and the plan's original
 * three-plus-three split projected past the §4.5 1000-line cap by Task 6. This
 * file carries §5 (STP) and §6 (ETP); `water-classes-2.spec.ts` carries §4
 * (cooling tower) and §1 (WTP); `water-classes-3.spec.ts` carries §2 (RO) and
 * §3 (softener).
 *
 * **The transcription helpers are imported from `stock-transcription.spec.ts`
 * and are no longer this file's.** `E5.1` wrote them here and exported them to
 * its two siblings, which was right for one pack; `E5.2` Task 2 moved them to a
 * pack-neutral home, because a *mechanical* spec importing a *water* spec for
 * `assertPointTable` reads as if the mechanical pack were a water one. Two
 * signatures widened with the move — `assertEntryIdentity` takes the domain and
 * `assertProvenance` takes the source document — and `assertNoConsentNumbers`
 * became `assertNoLimitNumbers`, whose `why` sentence this file supplies (the
 * CPCB Schedule VI one). What stays here is `assertCodDualTier`, which is a
 * claim about two water entries and about nothing else.
 *
 * **The generic claims are deliberately NOT restated here.** Pair-absence, the
 * alarm binding, the severity and category vocabularies parsed out of `0030`
 * and `0029`, the `meta.tier` iff rule, derived-point well-formedness, the KPI
 * cross-checks, the three maintenance vocabularies and key-set equality with
 * the DTO projection all run over every entry from `checkEntry` the moment a
 * class joins the pack index. What is here is only what the tag list asserts
 * and no schema can.
 *
 * **The claim this file adds that `checkEntry` deliberately does not make** is
 * the populated `philosophy` (plan §2): the six shipped electrical entries
 * carry none, so a catalog-wide assertion would fail six correct entries. It is
 * the water pack's property, so it is asserted per water entry.
 */

/**
 * The document every entry of this pack cites, spelled once and exported to
 * `water-classes-2.spec.ts` and `-3` — `assertProvenance` takes the source
 * document as an argument since `E5.2` Task 2, because the mechanical pack
 * cites a different one, and three copies of a file name in three specs is
 * three things to keep true. `checkEntry`'s `PACK_SOURCE_DOC` map holds the
 * same string on the mechanism side; the two agreeing is what a failing
 * citation check reports.
 */
export const WATER_TAG_LIST = "e5.1-derived-taglist-v1.md";

/**
 * The `why` every CPCB Schedule VI row passes to `assertNoLimitNumbers` — one
 * sentence, one place, because two blocks in this file cite it and a second
 * copy is a second thing to keep true. `assertNoLimitNumbers` is pack-neutral
 * and takes the regime as an argument: the mechanical pack's boiler passes its
 * IBR sentence to the same helper.
 */
const CPCB_CONSENT_REGIME =
  "This is a CPCB Schedule VI discharge-consent parameter: the consent value is per site and " +
  "per consent and is set at commissioning (ADR 0040 decision 4).";

/**
 * **The dual-tier claim, asserted from BOTH blocks** — `effluent_cod_mgl` is
 * `manual` on the STP (§5 spells it `M/X`) and `extended` on the ETP (§6 spells
 * it `X/M`), first-listed tier wins, both `required: false`.
 *
 * Called from each entry's block rather than once, because a single-entry
 * assertion would not show that the disagreement is deliberate: it is the only
 * place in the pack where one vocabulary code legitimately carries two tiers,
 * and `meta.tier` says what *that plant type* typically fits, not what the code
 * is. A sewage plant sends COD to a laboratory; an effluent plant with a
 * regulated discharge more often fits an online analyser.
 */
export function assertCodDualTier(): void {
  for (const [code, tier] of [
    ["water-stp", "manual"],
    ["water-etp", "extended"],
  ] as const) {
    const point = requireStockEntry(code).points.find(
      (row) => row.pointKey === "effluent_cod_mgl",
    );
    assert(
      point?.meta?.tier === tier,
      `${code} must file effluent_cod_mgl as meta.tier "${tier}". §5 spells its tier "M/X" and §6 ` +
        `spells the same code "X/M"; the first-listed tier wins (plan §5), so the STP files it ` +
        `manual and the ETP files it extended. Got "${String(point?.meta?.tier)}".`,
    );
    assert(
      point?.required === false,
      `${code}.effluent_cod_mgl must be required: false — both halves of the dual tier are ` +
        `optional, so only meta.tier differs between the two entries; got ${String(point?.required)}`,
    );
  }
}

// ===========================================================================
// §5 — `water-stp`
// ===========================================================================

const STP_CODE = "water-stp";

/**
 * §5's 18 table rows in the **document's own order**, which is the order
 * `sortOrder` follows — `[pointKey, tier, unit]`. Plan §5.1 lists the same 18
 * grouped by tier; the document is the authority on order.
 */
const STP_POINTS: readonly PointRow[] = [
  ["influent_flow_klh", "core", "KL/hr"],
  ["effluent_flow_klh", "core", "KL/hr"],
  ["aeration_do_mgl", "core", "mg/L"],
  ["mlss_mgl", "core", "mg/L"],
  ["effluent_turbidity_ntu", "core", "NTU"],
  ["effluent_tss_mgl", "extended", "mg/L"],
  ["effluent_ph", "core", "pH"],
  ["effluent_cl2_residual_mgl", "core", "mg/L"],
  ["effluent_bod_mgl", "manual", "mg/L"],
  ["effluent_cod_mgl", "manual", "mg/L"],
  ["blower_status", "core", null],
  ["blower_current_a", "core", "A"],
  ["ras_flow_klh", "extended", "KL/hr"],
  ["clarifier_sludge_level_pct", "extended", "%"],
  ["eq_tank_level_pct", "core", "%"],
  ["treated_tank_level_pct", "core", "%"],
  ["mbr_tmp_bar", "extended", "bar"],
  ["uv_status", "extended", null],
];

/**
 * §5's seven alarm bullets become **nine** rows: DO splits into low and high
 * (two meanings, two responses — the document writes them as one bullet with a
 * slash), and *"effluent turbidity/TSS high"* splits into two because the entry
 * declares two points.
 */
const STP_ALARMS: readonly AlarmRow[] = [
  ["do_low", "aeration_do_mgl", "critical", "operations"],
  ["do_high", "aeration_do_mgl", "info", "energy"],
  ["mlss_out_of_band", "mlss_mgl", "warning", "operations"],
  ["effluent_turbidity_high", "effluent_turbidity_ntu", "warning", "operations"],
  ["effluent_tss_high", "effluent_tss_mgl", "critical", "safety"],
  ["chlorine_residual_low", "effluent_cl2_residual_mgl", "critical", "safety"],
  ["blower_trip", "blower_status", "critical", "operations"],
  ["mbr_tmp_high", "mbr_tmp_bar", "warning", "operations"],
  ["eq_tank_high", "eq_tank_level_pct", "critical", "safety"],
];

/**
 * `water-stp` against `docs/e5.1-derived-taglist-v1.md` §5 (plan §5.1). The
 * first water entry authored, and plan §3's first escalation checkpoint keys on
 * it: what it proves is the six-module split, the pack index, the prefix map,
 * the alarm-philosophy shape and the `M/X` dual-tier rule.
 */
function checkStp(): void {
  const entry = requireStockEntry(STP_CODE);
  assertEntryIdentity(STP_CODE, entry, "stp", "water");

  // ---- 18 points, 11 core + 5 extended + 2 manual + 0 derived -------------

  assert(
    tierCount(entry, "core") === 11 &&
      tierCount(entry, "extended") === 5 &&
      tierCount(entry, "manual") === 2 &&
      tierCount(entry, "derived") === 0,
    `§5 marks 11 rows C, 5 X, 1 M and 1 M/X (manual, first-listed wins), and this class authors ` +
      `no derived code — 11/5/2/0. Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}` +
      `/${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(STP_CODE, "§5", entry, STP_POINTS);
  assertCodDualTier();

  assert(
    tierCount(entry, "derived") === 0,
    "§5's four derived codes are ALL deferred (plan §5.0) and plan §12 ruling 7 refuses " +
      "recovery_pct here — the STP's own derived quantity is reuse, and hydraulic recovery shown " +
      "where an operator expects reuse is the silent-wrong failure",
  );
  assertNoKpis(STP_CODE, entry, "§5");
  assertDeferralsAbsent(STP_CODE, entry);

  // ---- 9 alarms, every one a populated philosophy row --------------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(STP_CODE, "§5", alarms, STP_ALARMS);
  assertPhilosophyRows(STP_CODE, alarms);
  assertSkillAssignment(
    STP_CODE,
    alarms,
    {
      do_high: "controls",
      chlorine_residual_low: "controls",
      blower_trip: "mechanical",
      mbr_tmp_high: "mechanical",
      eq_tank_high: "civil",
    },
    ["do_low", "mlss_out_of_band", "effluent_turbidity_high", "effluent_tss_high"],
  );
  assertNoLimitNumbers(STP_CODE, alarms, ["effluent_tss_high"], CPCB_CONSENT_REGIME);

  // ---- 4 maintenance plans, none of them safety-critical -----------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 4, `plan §5.7 authors 4 STP maintenance plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 0,
    `no STP plan is safetyCritical — the pack's three are the ETP guard pond, the cooling tower ` +
      `Legionella program and the WTP chlorine dosing service (plan §5.7), and none is here. Got ` +
      `${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join("; ")}`,
  );

  const mbr = plans.find((plan) => plan.category === "condition_based");
  assert(
    mbr !== undefined && mbr.generationMode === "condition",
    `${STP_CODE} must carry exactly one condition_based plan generated in "condition" mode — the ` +
      "MBR clean-in-place, which is due when trans-membrane pressure rises and not on a date " +
      "(plan §5.7). Asserting the pair and not just the category is deliberate: a category with a " +
      `calendar generationMode is a condition plan in name only. Got category ` +
      `${String(mbr?.category)} / generationMode ${String(mbr?.generationMode)}.`,
  );
  assert(
    typeof mbr?.triggerSummary === "string" && mbr.triggerSummary.includes("mbr_tmp_bar"),
    `${STP_CODE}'s condition_based plan must name mbr_tmp_bar in its triggerSummary — the point ` +
      "the mbr_tmp_high alarm binds is the condition the plan is scheduled on, and nothing else " +
      "in the entry records which point that is",
  );
  assertMaintenanceBounds(STP_CODE, entry);
  assertProvenance(STP_CODE, entry, WATER_TAG_LIST, "§5");
}

// ===========================================================================
// §6 — `water-etp`
// ===========================================================================

const ETP_CODE = "water-etp";

/**
 * §6's 17 table rows in the document's own order — `[pointKey, tier, unit]`.
 * Five carry a `◆` in the document, meaning *read directly from the client's
 * own reference dashboards*: `neutralization_ph`, `bio_mlss_mgl`,
 * `settling_tss_mgl`, `clarifier_turbidity_ntu` and `discharge_flow_klh`. That
 * makes §6 the least provisional section in the pack, and those five the rows a
 * redline is least likely to move.
 */
const ETP_POINTS: readonly PointRow[] = [
  ["influent_flow_klh", "core", "KL/hr"],
  ["neutralization_ph", "core", "pH"],
  ["dosing_acid_lph", "extended", "L/hr"],
  ["dosing_alkali_lph", "extended", "L/hr"],
  ["bio_mlss_mgl", "core", "mg/L"],
  ["bio_do_mgl", "core", "mg/L"],
  ["settling_tss_mgl", "extended", "mg/L"],
  ["clarifier_turbidity_ntu", "extended", "NTU"],
  ["discharge_flow_klh", "core", "KL/hr"],
  ["discharge_ph", "core", "pH"],
  ["effluent_cod_mgl", "extended", "mg/L"],
  ["effluent_bod_mgl", "manual", "mg/L"],
  ["oil_grease_mgl", "manual", "mg/L"],
  ["sludge_holding_level_pct", "extended", "%"],
  ["filter_press_status", "extended", null],
  ["transfer_pump_status", "core", null],
  ["guard_pond_level_pct", "extended", "%"],
];

/**
 * §6's six alarm bullets become **eight** rows: *"COD/TSS high"* splits into
 * two because the entry declares two points, and *"dosing tank empty"* splits
 * into acid and alkali — two declared dosing lines, two reagents, two refills,
 * the same split `F2.12` made for *"cooling fan/pump failure"*.
 */
const ETP_ALARMS: readonly AlarmRow[] = [
  ["discharge_ph_out_of_consent", "discharge_ph", "critical", "safety"],
  ["discharge_cod_high", "effluent_cod_mgl", "critical", "safety"],
  ["settling_tss_high", "settling_tss_mgl", "warning", "operations"],
  ["bio_do_low", "bio_do_mgl", "critical", "operations"],
  ["acid_dosing_lost", "dosing_acid_lph", "warning", "operations"],
  ["alkali_dosing_lost", "dosing_alkali_lph", "warning", "operations"],
  ["guard_pond_high", "guard_pond_level_pct", "critical", "safety"],
  ["filter_press_fault", "filter_press_status", "warning", "operations"],
];

/**
 * `water-etp` against `docs/e5.1-derived-taglist-v1.md` §6 (plan §5.2) — the
 * entry with the regulatory alarms and the `X/M` dual-tier row, and zero
 * derived points, which is the opposite shape to the cooling tower's.
 */
function checkEtp(): void {
  const entry = requireStockEntry(ETP_CODE);
  assertEntryIdentity(ETP_CODE, entry, "etp", "water");

  // ---- 17 points, 7 core + 8 extended + 2 manual + 0 derived --------------

  assert(
    tierCount(entry, "core") === 7 &&
      tierCount(entry, "extended") === 8 &&
      tierCount(entry, "manual") === 2 &&
      tierCount(entry, "derived") === 0,
    `§6 marks 7 rows C, 7 X and 1 X/M (extended, first-listed wins) and 2 M, and all four of its ` +
      `derived codes are deferred — 7/8/2/0. Got ${tierCount(entry, "core")}/` +
      `${tierCount(entry, "extended")}/${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(ETP_CODE, "§6", entry, ETP_POINTS);
  assertCodDualTier();
  assertNoKpis(ETP_CODE, entry, "§6");
  assertDeferralsAbsent(ETP_CODE, entry);

  // ---- the row §6's own alarm bullet asks for and does not declare --------

  const keys = new Set(entry.points.map((point) => point.pointKey));
  assert(
    !keys.has("dosing_tank_level_pct"),
    `${ETP_CODE} declares dosing_tank_level_pct, and it must not. §6's "dosing tank empty" bullet ` +
      "has no level point to bind: the table declares dosing RATES and no reagent tank level at " +
      "all. The acid_dosing_lost and alkali_dosing_lost rows bind the rates and say what a " +
      "collapse means, which is the honest encoding. A dosing tank level is a v2 REDLINE " +
      "CANDIDATE for the tag list, whose own instruction to the client is \"add what is missing\" " +
      "— it is not a key to invent here, because a point key is seeded into bms.point_keys, " +
      "foreign-keyed by 0058 and permanent, while a redline is free.",
  );

  // ---- 8 alarms, every one a populated philosophy row ---------------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(ETP_CODE, "§6", alarms, ETP_ALARMS);
  assertPhilosophyRows(ETP_CODE, alarms);
  assertSkillAssignment(
    ETP_CODE,
    alarms,
    {
      acid_dosing_lost: "controls",
      alkali_dosing_lost: "controls",
      guard_pond_high: "civil",
      filter_press_fault: "mechanical",
    },
    ["discharge_ph_out_of_consent", "discharge_cod_high", "settling_tss_high", "bio_do_low"],
  );
  assertNoLimitNumbers(
    ETP_CODE,
    alarms,
    ["discharge_ph_out_of_consent", "discharge_cod_high"],
    CPCB_CONSENT_REGIME,
  );

  // ---- 4 maintenance plans, the guard pond the only critical one ----------

  const plans = maintenanceOf(entry);
  assert(plans.length === 4, `plan §5.7 authors 4 ETP maintenance plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 1,
    `exactly one §6 plan is safetyCritical — the guard pond and bund inspection; got ` +
      `${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join("; ") || "(none)"}`,
  );
  const pond = safetyCritical[0];
  assert(
    typeof pond?.title === "string" && pond.title.includes("Guard pond"),
    "the one safetyCritical ETP plan must be the guard pond and bund inspection — the pond is the " +
      "last containment before an unconsented discharge, and a bund breach IS the unconsented " +
      `discharge. Got: "${String(pond?.title)}"`,
  );
  assert(
    pond?.category === "safety_critical",
    `the guard pond plan must be category "safety_critical"; got "${String(pond?.category)}"`,
  );
  assertMaintenanceBounds(ETP_CODE, entry);
  assertProvenance(ETP_CODE, entry, WATER_TAG_LIST, "§6");
}

/**
 * Every per-class block in this file. Called by `water-classes.test.ts`, its
 * **name-sibling** wrapper — `tests/repo-invariants.test.ts` matches the pair
 * by name, and a spec imported from a differently-named wrapper still runs but
 * is absent from coverage, which is the half the import cannot fix.
 */
export function runWaterClassEntryTests(): void {
  checkStp();
  checkEtp();
}
