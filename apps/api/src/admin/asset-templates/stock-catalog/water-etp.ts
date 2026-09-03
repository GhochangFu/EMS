import { CORE, EXTENDED, MANUAL, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The water pack's effluent-treatment-plant class — `E5.1`, ADR 0040
 * decision 1, ADR 0052 decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/e5.1-derived-taglist-v1.md` §6 — *"ETP — effluent treatment
 * plant (neutralization + physico-chemical + biological)"*.
 *
 * **§6 IS THE LEAST PROVISIONAL SECTION IN THE PACK, AND THAT IS WORTH
 * KNOWING BEFORE THE REDLINE.** Five of its rows carry a `◆` in the document,
 * meaning *read directly from the client's own reference dashboards* (SOW
 * pp. 9-10, `docs/ux/ion-exchange-reference-alignment.md`):
 * **`neutralization_ph`, `bio_mlss_mgl`, `settling_tss_mgl`,
 * `clarifier_turbidity_ntu` and `discharge_flow_klh`**. Those five come from
 * the client's own artifact rather than from published practice, so they are
 * the rows a v2 redline is least likely to move. The entry as a whole is still
 * PROVISIONAL — derived, not client-confirmed — because the other twelve rows
 * and every alarm and plan below are.
 *
 * **17 POINTS — 7 core + 8 extended + 2 manual + 0 derived**, §6's table rows
 * in the **document's own order**, which is what `sortOrder` follows. Tier `C`
 * is required and `meta.tier: "core"`; `X` is optional and `"extended"`; `M` is
 * optional and `"manual"`, entered by hand through `F1.8`/`F1.9` and never
 * mapped from a data key.
 *
 * **THE DUAL-TIER ROW, THE OTHER HALF.** `effluent_cod_mgl` is spelled `X/M`
 * here and `M/X` in §5. The rule is stated once and applied twice: **the
 * first-listed tier wins**, so this entry files it `extended` and `water-stp`
 * files the same code `manual`. Both are `required: false`, so only `meta.tier`
 * differs — and that is correct rather than a clash, because `meta.tier` says
 * what *that plant type* typically fits, not what the code is. An effluent
 * plant with a consented discharge more often fits an online COD analyser; a
 * sewage plant sends the sample to a laboratory. The two entry specs assert
 * both halves from both blocks, because a single-entry assertion would not show
 * the disagreement is deliberate.
 *
 * **ZERO DERIVED POINTS.** All four of §6's `D` codes are deferred and named
 * (ADR 0051 Amendment 6 decision 8: a code with no `bms-calc-v1` formula is not
 * vocabulary, and a deferral is never a placeholder):
 *
 *  - `neutralization_chem_gkl` — `dosing_acid_lph` and `dosing_alkali_lph` are
 *    litres per hour of a **solution**, and grams of reagent per KL needs what
 *    those litres contain: a site attribute. The same shape as the WTP's
 *    `specific_chlorine_gkl`.
 *  - `cod_removal_pct` — needs **influent** COD; §6 carries the outlet only.
 *  - `hydraulic_load_pct` — needs the design capacity, an asset attribute.
 *    Deferred on the STP for the same reason.
 *  - `recycle_pct` — needs a reuse meter §6 does not list.
 *
 * `recovery_pct` is not authored here either (plan §12 ruling 7): the ETP's
 * meaningful ratio is recycle, not hydraulic recovery, and the two are
 * different numbers.
 *
 * **NO `content.kpis` AT ALL**, structurally rather than as a deferral of
 * effort (plan §5.0): every ratio §6 names that the grammar can express would
 * be a named derived code and therefore a *point*, and all four of the ones it
 * names are deferred, so there is nothing left for a KPI to be.
 *
 * **ALARMS — 8, from §6's six bullets.** *"COD/TSS high"* splits into two
 * because this entry declares both points, and *"dosing tank empty"* splits
 * into acid and alkali — two declared dosing lines, two reagents, two refills,
 * the same split `F2.12` made for *"cooling fan/pump failure"*. Every row is
 * **pair-absent** — no `thresholdValue`, no `operator` (ADR 0019 Amendment 2,
 * and B7: *limit values are set per site at commissioning*) — and every row
 * carries a populated `philosophy`, which ADR 0040 decision 4 requires of this
 * pack and no shipped electrical entry has.
 *
 * **`"DOSING TANK EMPTY"` HAS NO LEVEL POINT TO BIND, AND NONE IS INVENTED.**
 * §6 declares dosing *rates* and no reagent tank level at all. `acid_dosing_lost`
 * and `alkali_dosing_lost` bind the two rates and say what a collapse means,
 * which is the honest encoding; a `dosing_tank_level_pct` row is a **v2 redline
 * candidate** for the document, whose own instruction to the client is *"add
 * what is missing"*. It is named here rather than invented, because a point key
 * is seeded into `bms.point_keys`, foreign-keyed by `0058` and permanent, while
 * a redline is free. The entry spec asserts no such key is declared.
 *
 * **`philosophy.skill` is set on four rows and omitted on four** (plan §12
 * ruling 6). `bms.alarm_skills` (migration `0034`) holds `electrical`,
 * `mechanical`, `hvac`, `controls` and `civil` — and **no process trade**. So
 * `acid_dosing_lost` and `alkali_dosing_lost` are `controls` (a dosing pump and
 * its controller), `guard_pond_high` is `civil` (a pond and its bund) and
 * `filter_press_fault` is `mechanical` (a press). **`discharge_ph_out_of_consent`,
 * `discharge_cod_high`, `settling_tss_high` and `bio_do_low` carry no `skill`
 * at all**: they are process-chemistry excursions answered by a plant operator.
 * A `process` skill is a separate backlog row with its own migration; when it
 * lands, those four gain a skill in a `stockVersion` 2.
 *
 * **THE CONSENT ROWS CARRY NO NUMBER ANYWHERE**, including inside their
 * philosophy. `discharge_ph_out_of_consent` is the row the tag list calls
 * *"the one regulators check first"*, and `discharge_cod_high` is the treatment
 * failure behind it; pH, COD, BOD, TSS and oil & grease are all **CPCB Schedule
 * VI** consent parameters, and a consent value is per site and per consent
 * (ADR 0040 decision 4). The entry spec asserts the absence of a digit in both
 * rows' messages and in all their philosophy strings, because the pair-absence
 * check cannot see inside a philosophy string.
 *
 * **THREE DECLARED ROWS CARRY NO ALARM, AND THAT IS A DECISION.**
 * `effluent_bod_mgl`, `oil_grease_mgl` and `sludge_holding_level_pct` are
 * declared and unalarmed, because §6's bullets name none of them. BOD and oil &
 * grease are laboratory results that arrive days after the condition they
 * describe, so an alarm on them would fire against a plant state that no longer
 * exists — they are consent parameters carried for the record and for `F1.8`
 * manual entry. The sludge holding level's failure mode is the press stopping,
 * which `filter_press_fault` already reports one stage upstream. Recorded so
 * the gap reads as a decision rather than an omission.
 *
 * **MAINTENANCE — 4 plans, PROVISIONAL** (plan §12 ruling 5). The tag list has
 * no maintenance section at all, so these are derived from **CPCB Schedule VI
 * consent-monitoring practice**: the press round that keeps dewatering
 * available, the dosing-pump and reagent check behind the two dosing alarms,
 * the analyser calibration the consent parameters depend on, and the pond and
 * bund inspection. **The guard pond and bund inspection is the only
 * `safetyCritical` plan on this entry** — a bund breach *is* an unconsented
 * discharge, which is the failure the whole consent regime exists to prevent —
 * and it is one of the pack's three, beside the cooling tower's Legionella
 * program and the WTP's chlorine dosing service.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the
 * site's telemetry wiring, which the tag list does not know and the catalog
 * must not guess, so an imported draft cannot be instantiated until an operator
 * fills the patterns in. The two `M` rows keep `null` forever by design and
 * land in `skippedPoints`, so they never get an `asset_points` row until `F1.8`
 * manual entry gives them somewhere to write.
 *
 * `E5.1` pass B shipped this module as a skeleton carrying one placeholder
 * point; **pass C (this commit) replaced it with §6's full row set**, and no
 * placeholder remains in this file.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `water-etp` **v1** (2026-09-03, `E5.1`): authored from
 *    `e5.1-derived-taglist-v1.md` §6, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const WATER_ETP: StockAssetTemplateEntry = {
  code: "water-etp",
  name: "Effluent treatment plant (neutralization + biological)",
  assetType: "etp",
  domain: "water",
  description:
    "Effluent treatment plant — neutralization, physico-chemical and biological stages with a " +
    "consented discharge. Authored from docs/e5.1-derived-taglist-v1.md §6 (PROVISIONAL — " +
    "derived from published practice and the client's reference dashboards, not " +
    "client-confirmed; five rows are read directly from the client's own dashboards and are the " +
    "least provisional in the pack). Tier C points are required, X optional, M entered by hand; " +
    "alarm rows carry a meaning and no limit, and the discharge-consent rows carry the CPCB " +
    "Schedule VI meaning rather than a number, because a consent value is per site and per " +
    "consent.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "discharge_ph_out_of_consent",
        pointKey: "discharge_ph",
        severity: "critical",
        category: "safety",
        message:
          "Final discharge pH outside the consent band — the first parameter a regulator checks, " +
          "and a CPCB Schedule VI consent condition. The band is a per-site consent value set at " +
          "commissioning, so this row carries the meaning and no number.",
        philosophy: {
          cause:
            "Neutralization dosing lost or overshooting, a pH electrode out of calibration, or a " +
            "slug of acidic or alkaline effluent arriving faster than the tank can buffer it.",
          impact:
            "The discharge leaves outside the consent the site holds. This is the condition a " +
            "regulator samples for first, and the one that reaches an inspection record and a " +
            "show-cause notice.",
          action:
            "Divert to the guard pond if the site can, confirm the reading against a hand-held " +
            "meter, and prove both dosing lines are delivering before the discharge is resumed.",
        },
      },
      {
        code: "discharge_cod_high",
        pointKey: "effluent_cod_mgl",
        severity: "critical",
        category: "safety",
        message:
          "Chemical oxygen demand at discharge high — a treatment failure upstream, and a CPCB " +
          "Schedule VI consent parameter whose value is per site and per consent.",
        philosophy: {
          cause:
            "The biological stage under-performing, an organic load above design, a toxic slug " +
            "that has inhibited the biomass, or short-circuiting through the settling stage.",
          impact:
            "Organic load leaves with the discharge. It is a consent parameter in its own right " +
            "and it is also the number that shows the treatment train is not doing its work.",
          action:
            "Confirm against the laboratory result, check the biological stage's dissolved oxygen " +
            "and solids, and look upstream for the load or the inhibitor that changed.",
        },
      },
      {
        code: "settling_tss_high",
        pointKey: "settling_tss_mgl",
        severity: "warning",
        category: "operations",
        message:
          "Settling tank outlet solids high — carryover into the discharge line. The limit is set " +
          "per site at commissioning.",
        philosophy: {
          cause:
            "Coagulant or flocculant dosing off its duty, a hydraulic surge through the settling " +
            "tank, or a sludge blanket that has not been drawn down.",
          impact:
            "Solids carried past the settling stage arrive at the discharge, where suspended " +
            "solids is itself a consent parameter, and they mask the quality of everything " +
            "measured downstream of them.",
          action:
            "Check the coagulant and flocculant dosing, draw the sludge blanket down, and reduce " +
            "throughput until the outlet clears.",
        },
      },
      {
        code: "bio_do_low",
        pointKey: "bio_do_mgl",
        severity: "critical",
        category: "operations",
        message:
          "Biological tank dissolved oxygen low — the biology is at risk. The band is set per site " +
          "at commissioning.",
        philosophy: {
          cause:
            "Aeration below demand, a blinded diffuser grid, an organic or toxic load above what " +
            "the biomass can take, or a dissolved-oxygen probe that has drifted.",
          impact:
            "The biomass stops treating and then starts dying. The plant loses its biological " +
            "stage for days, and COD at discharge rises behind it.",
          action:
            "Raise aeration, confirm the reading against a hand-held meter, and look upstream for " +
            "the load or the inhibitor that arrived.",
        },
      },
      {
        code: "acid_dosing_lost",
        pointKey: "dosing_acid_lph",
        severity: "warning",
        category: "operations",
        message:
          "Acid dosing rate collapsed while neutralization pH sits high — the reagent tank is " +
          "empty, or the dosing pump has lost prime.",
        philosophy: {
          cause:
            "An empty acid tank, a dosing pump that has lost prime or stopped, a blocked injection " +
            "point, or a closed isolation valve on the dosing line.",
          impact:
            "Neutralization drifts alkaline and the discharge pH follows it out of the consent " +
            "band — this alarm is the cause the discharge pH alarm reports later.",
          action:
            "Check the reagent tank level and refill it, prove the dosing pump is delivering, and " +
            "clear the injection point.",
          skill: "controls",
        },
      },
      {
        code: "alkali_dosing_lost",
        pointKey: "dosing_alkali_lph",
        severity: "warning",
        category: "operations",
        message:
          "Alkali or lime dosing rate collapsed while neutralization pH sits low — the same " +
          "failure on the other reagent.",
        philosophy: {
          cause:
            "An empty alkali or lime tank, a dosing pump off duty, or a lime line scaled or " +
            "blocked at the injection point — lime slurry blocks where a clear reagent would not.",
          impact:
            "Neutralization drifts acidic and the discharge pH follows it out of the consent band. " +
            "An acidic discharge also attacks the discharge line itself.",
          action:
            "Check the reagent tank and refill it, prove the dosing pump is delivering, and flush " +
            "the lime line and its injection point.",
          skill: "controls",
        },
      },
      {
        code: "guard_pond_high",
        pointKey: "guard_pond_level_pct",
        severity: "critical",
        category: "safety",
        message:
          "Guard pond level high — the pond is the last containment before an unconsented " +
          "discharge. The level is set per site at commissioning.",
        philosophy: {
          cause:
            "Sustained diversion into the pond while the plant is off specification, a transfer " +
            "pump off duty, or rainfall on an open pond with no spare freeboard.",
          impact:
            "The pond is the site's last containment. Above its freeboard, the next event is an " +
            "unconsented discharge to ground or to a watercourse, with the bund as the only thing " +
            "left between the two.",
          action:
            "Return the pond to the plant inlet as fast as treatment allows, stop the diversion at " +
            "source, and walk the bund and the overflow route while the level is still " +
            "recoverable.",
          skill: "civil",
        },
      },
      {
        code: "filter_press_fault",
        pointKey: "filter_press_status",
        severity: "warning",
        category: "operations",
        message:
          "Sludge dewatering stopped — the sludge holding tank fills, and the plant backs up " +
          "behind it.",
        philosophy: {
          cause:
            "A hydraulic power pack fault, a blinded or torn filter cloth, a cake that has not " +
            "released, or a feed pump that has stopped.",
          impact:
            "Sludge accumulates in the holding tank. When it is full the clarifier cannot be " +
            "drawn down, solids carry over, and the discharge follows the sludge upstream.",
          action:
            "Clear the press, inspect and wash the cloths, and confirm the hydraulic pack and the " +
            "feed pump before the holding tank reaches its working limit.",
          skill: "mechanical",
        },
      },
    ],
    maintenance: [
      {
        title: "Filter press cloth inspection and cake removal",
        category: "inspection_round",
        generationMode: "calendar",
        intervalDays: 14,
        estimatedMinutes: 90,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Inspect and wash the filter cloths, clear any cake that has not released, and check the " +
          "hydraulic pack. filter_press_status is the point the filter_press_fault alarm binds, " +
          "so a press left blinded turns that alarm into a standing condition nobody reads.",
      },
      {
        title: "Dosing pump calibration and reagent tank check",
        category: "calibration",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 120,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Draw-down test both dosing pumps against their set rate, refill and check the acid and " +
          "alkali tanks, and flush the lime injection point. dosing_acid_lph and " +
          "dosing_alkali_lph are the points the two dosing alarms bind; a pump that reports a " +
          "rate it is not delivering is the failure neither alarm can see.",
      },
      {
        title: "pH and COD analyser calibration",
        category: "calibration",
        generationMode: "calendar",
        intervalDays: 30,
        estimatedMinutes: 90,
        priority: "high",
        safetyCritical: false,
        complianceRef: "CPCB Schedule VI consent monitoring",
        triggerSummary:
          "Calibrate the neutralization and discharge pH electrodes and the COD analyser against " +
          "reference solutions. neutralization_ph, discharge_ph and effluent_cod_mgl are consent " +
          "parameters, so a drifted electrode is either an unreported breach or a shutdown nobody " +
          "needed.",
      },
      {
        title: "Guard pond and bund inspection",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 30,
        estimatedMinutes: 60,
        priority: "critical",
        safetyCritical: true,
        complianceRef: "CPCB Schedule VI consent monitoring",
        triggerSummary:
          "Walk the guard pond bund, the liner where it is visible, the freeboard and the " +
          "overflow route. The pond is the last containment before an unconsented discharge and a " +
          "bund breach IS that discharge, which is why this is the entry's one safetyCritical " +
          "plan. guard_pond_level_pct reports the level and nothing reports the bund.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "influent_flow_klh", label: "Raw effluent inlet flow", unit: "KL/hr", required: true, sortOrder: 0, meta: CORE },
    // ◆ — read directly from the client's own reference dashboards. Five rows
    // carry the marker; they are the least provisional in the pack.
    { ...MEASURED, pointKey: "neutralization_ph", label: "Neutralization tank pH", unit: "pH", required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "dosing_acid_lph", label: "Acid dosing rate", unit: "L/hr", required: false, sortOrder: 2, meta: EXTENDED },
    { ...MEASURED, pointKey: "dosing_alkali_lph", label: "Alkali/lime dosing rate", unit: "L/hr", required: false, sortOrder: 3, meta: EXTENDED },
    { ...MEASURED, pointKey: "bio_mlss_mgl", label: "Biological treatment MLSS", unit: "mg/L", required: true, sortOrder: 4, meta: CORE }, // ◆
    { ...MEASURED, pointKey: "bio_do_mgl", label: "Biological tank DO", unit: "mg/L", required: true, sortOrder: 5, meta: CORE },
    { ...MEASURED, pointKey: "settling_tss_mgl", label: "Settling tank outlet TSS", unit: "mg/L", required: false, sortOrder: 6, meta: EXTENDED }, // ◆
    { ...MEASURED, pointKey: "clarifier_turbidity_ntu", label: "Clarifier outlet turbidity", unit: "NTU", required: false, sortOrder: 7, meta: EXTENDED }, // ◆
    { ...MEASURED, pointKey: "discharge_flow_klh", label: "Final discharge flow", unit: "KL/hr", required: true, sortOrder: 8, meta: CORE }, // ◆
    { ...MEASURED, pointKey: "discharge_ph", label: "Final discharge pH", unit: "pH", required: true, sortOrder: 9, meta: CORE },
    // §6's X/M row — the first-listed tier wins, so it is extended here and
    // manual on the STP. See the module docblock.
    { ...MEASURED, pointKey: "effluent_cod_mgl", label: "COD", unit: "mg/L", required: false, sortOrder: 10, meta: EXTENDED },
    // The two M rows — entered by hand (F1.8 / F1.9), never mapped from a data
    // key, so they land in skippedPoints at instantiation and carry no
    // asset_points row until manual entry exists.
    { ...MEASURED, pointKey: "effluent_bod_mgl", label: "BOD", unit: "mg/L", required: false, sortOrder: 11, meta: MANUAL },
    { ...MEASURED, pointKey: "oil_grease_mgl", label: "Oil & grease", unit: "mg/L", required: false, sortOrder: 12, meta: MANUAL },
    { ...MEASURED, pointKey: "sludge_holding_level_pct", label: "Sludge holding tank level", unit: "%", required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "filter_press_status", label: "Sludge dewatering run status", unit: null, required: false, sortOrder: 14, meta: EXTENDED },
    { ...MEASURED, pointKey: "transfer_pump_status", label: "Inter-stage transfer pump status", unit: null, required: true, sortOrder: 15, meta: CORE },
    { ...MEASURED, pointKey: "guard_pond_level_pct", label: "Guard/holding pond level", unit: "%", required: false, sortOrder: 16, meta: EXTENDED },
  ],
};
