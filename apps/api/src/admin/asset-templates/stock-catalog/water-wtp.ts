import { CORE, derived, EXTENDED, MANUAL, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The water pack's water-treatment-plant class — `E5.1`, ADR 0040 decision 1,
 * ADR 0052 decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/e5.1-derived-taglist-v1.md` §1 — *"WTP — water treatment
 * plant (clarifier + filtration + disinfection)"*. PROVISIONAL: derived from
 * published practice, not client-confirmed.
 *
 * **20 POINTS — 11 core + 5 extended + 2 manual + 2 DERIVED.** §1's 18 table
 * rows in the document's own order (`sortOrder` 0-17), then the two authored
 * derived codes (18-19).
 *
 * **THE TWO FORMULAS** (plan §5.0):
 *
 *  - `recovery_pct` = `{treated_water_flow_klh} / {raw_water_flow_klh} * 100` —
 *    the fraction of the intake stream that leaves as product.
 *  - `turbidity_removal_pct` =
 *    `(1 - {filtered_turbidity_ntu} / {raw_turbidity_ntu}) * 100` — what the
 *    clarifier and the filters together actually removed.
 *
 * Both take their inputs from the same controller at the same scan rate, so
 * both keep the 300 s default `maxInputAgeSeconds` (spelled `null`). **Division
 * by zero is handled and must not be guarded**: `evaluate.ts` returns
 * `non_finite` for a non-finite result, so recovery at zero raw flow and
 * turbidity removal at zero raw turbidity produce **no value for that reading**
 * rather than a wrong one. Do not add a `clamp` or a `max(…, 0.001)` — a
 * fabricated denominator turns "no data" into a plausible number.
 *
 * **`recovery_pct`, NOT `pct_recovery` — and this is the one spelling in the
 * pack that disagrees with its source document.** The tag list writes
 * `pct_recovery` in §1's and §2's *Derived:* lines. Plan §12 ruling 1 ruled the
 * code `recovery_pct`: ADR 0040 decision 2's convention is `snake_case` plus a
 * unit suffix, and every other percentage in this vocabulary is `*_pct`. The
 * code is seeded write-once into `bms.point_keys`, so the spelling is
 * permanent; the document's two rows are corrected in the closure `docs:` PR so
 * the handout and the product agree at the moment a client reads both.
 *
 * **`recovery_pct` IS ONE CODE WITH TWO FORMULAS, AND THAT IS CORRECT, NOT A
 * CLASH.** `water-ro` authors the same code as
 * `{permeate_flow_klh} / {feed_flow_klh} * 100`. ADR 0051 Amendment 6
 * decision 5 rules **one code, one *meaning***, and the meaning is identical on
 * both plants — *the fraction of the input stream that leaves as product*. Only
 * the input names differ, exactly as `load_pct` means the same thing on four
 * electrical classes. The code is promoted **once** into the vocabulary and
 * authored **twice**; `tests/f2.13`'s distinct-key bound already accounts for
 * it. A reviewer who reads the two modules side by side will suspect a bug
 * here, which is why the sentence is in both docblocks.
 *
 * **ONE DERIVED CODE IS DEFERRED.** `specific_chlorine_gkl` — §1 writes it as
 * *dose ÷ flow*, and `chlorine_dose_lph` is **litres per hour of hypochlorite
 * SOLUTION**. Grams of chlorine per KL needs the solution strength, which is a
 * site attribute the tag list does not carry, so the formula looks trivially
 * expressible until you ask what the litres contain. Named and never
 * placeholdered (ADR 0051 Amendment 6 decision 8).
 *
 * **NO `content.kpis` AT ALL**, structurally rather than as a deferral of
 * effort (plan §5.0): both of §1's expressible ratios are named derived codes
 * and therefore points, and the third is deferred, so there is nothing left for
 * a KPI to be.
 *
 * **ALARMS — 6, from §1's five bullets.** *"residual chlorine low / high"*
 * splits into two: they are opposite failures — a disinfection failure and an
 * overdose — bound to one point at two bands, the same shape the cooling
 * tower's cycles rows and the feeder's voltage rows take. Every row is
 * **pair-absent** — no `thresholdValue`, no `operator` (ADR 0019 Amendment 2,
 * and B7: *limit values are set per site at commissioning*) — and every row
 * carries a populated `philosophy`, which ADR 0040 decision 4 requires.
 *
 * **`philosophy.skill` is set on five rows and omitted on one** (plan §12
 * ruling 6). `bms.alarm_skills` (migration `0034`) holds `electrical`,
 * `mechanical`, `hvac`, `controls` and `civil` — and no process trade. So both
 * chlorine rows are `controls` (a dosing controller and a residual analyser),
 * `filter_dp_high` and `intake_pump_trip` are `mechanical` (a filter bed and a
 * pump) and `clearwell_level_low` is `civil` (a reservoir).
 * **`filtered_turbidity_high` carries no `skill`**: filter breakthrough is a
 * process judgement about the barrier itself — whether to take the filter off
 * line, backwash it early or reduce the rate — and it is answered by the plant
 * operator, not by a trade. It gains a skill in a `stockVersion` 2 when a
 * `process` code exists.
 *
 * **NO CPCB CONSENT ROW.** §1 is the potable side; its regulatory frame is
 * drinking-water quality rather than CPCB Schedule VI discharge consent, and
 * the tag list gives no drinking-water standard to cite. The rows still carry
 * no limit value — the whole pack's rule — and
 * `filtered_turbidity_high`'s philosophy says what turbidity stands proxy for
 * rather than what number it must stay under.
 *
 * **THREE DECLARED ROWS CARRY NO ALARM, AND THAT IS A DECISION.**
 * `settled_turbidity_ntu`, `treated_conductivity_uscm` and
 * `clarifier_sludge_level_pct` are declared and unalarmed, because §1's bullets
 * name none of them: clarifier performance shows up at the filter outlet, which
 * *is* alarmed, and conductivity on a potable plant is a trend rather than an
 * excursion. The two `M` rows are unalarmed for the pack's general reason — a
 * laboratory result arrives after the condition it describes. Recorded so the
 * gaps read as decisions.
 *
 * **MAINTENANCE — 4 plans, PROVISIONAL** (plan §12 ruling 5). Derived from
 * **conventional WTP practice**: the filter media and backwash round, the
 * chlorine dosing service and residual analyser calibration, the clarifier
 * scraper drive service, and the turbidimeter calibration. **The chlorine
 * dosing service is the only `safetyCritical` plan on this entry** — the
 * disinfection barrier is what the whole plant exists to guarantee, and it is
 * the barrier the two residual alarms report on. It is one of the pack's three,
 * beside the ETP's guard pond and the cooling tower's Legionella program.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the
 * site's telemetry wiring, which the tag list does not know and the catalog
 * must not guess, so an imported draft cannot be instantiated until an operator
 * fills the patterns in. The two `M` rows keep `null` forever by design and
 * land in `skippedPoints`, so they never get an `asset_points` row until `F1.8`
 * manual entry gives them somewhere to write.
 *
 * `E5.1` pass B shipped this module as a skeleton carrying one placeholder
 * point; **pass C (this commit) replaced it with §1's full row set**, and no
 * placeholder remains in this file.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `water-wtp` **v1** (2026-09-03, `E5.1`): authored from
 *    `e5.1-derived-taglist-v1.md` §1, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const WATER_WTP: StockAssetTemplateEntry = {
  code: "water-wtp",
  name: "Water treatment plant (clarifier + filtration + disinfection)",
  assetType: "wtp",
  domain: "water",
  description:
    "Water treatment plant — raw water intake, coagulation and clarification, filtration and " +
    "chlorination to a clear water reservoir. Authored from " +
    "docs/e5.1-derived-taglist-v1.md §1 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required, X optional, M entered by hand; alarm rows " +
    "carry a meaning and no limit. Two derived points — recovery and turbidity removal — are " +
    "computed from the measured rows and need no extra instrument.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "filtered_turbidity_high",
        pointKey: "filtered_turbidity_ntu",
        severity: "critical",
        category: "safety",
        message:
          "Filter outlet turbidity high — filter breakthrough. The limit is set per site at " +
          "commissioning against the standard the plant is operated to.",
        philosophy: {
          cause:
            "Media exhausted or displaced, a backwash run short, coagulation upstream not doing " +
            "its work, or a filter run pushed past its head-loss limit.",
          impact:
            "Turbidity is the proxy the whole disinfection barrier is judged on: particles " +
            "shelter organisms from chlorine, so breakthrough compromises the barrier even while " +
            "the residual still reads correctly.",
          action:
            "Take the filter off line and backwash it, check the coagulant dose and the clarifier " +
            "upstream, and inspect the media depth and condition before returning it to service.",
        },
      },
      {
        code: "chlorine_residual_low",
        pointKey: "treated_cl2_residual_mgl",
        severity: "critical",
        category: "safety",
        message:
          "Treated water residual chlorine below the site minimum — disinfection failure. The " +
          "minimum is set per site at commissioning.",
        philosophy: {
          cause:
            "A dosing pump that has lost prime or stopped, degraded or empty hypochlorite stock, " +
            "a chlorine demand higher than the dose allows for, or a residual analyser out of " +
            "calibration.",
          impact:
            "Water leaves the plant without a proven disinfection barrier, and the clear water " +
            "reservoir carries it downstream before anybody samples it.",
          action:
            "Confirm the residual with a hand-held test, prove the dosing pump is delivering, " +
            "check the hypochlorite strength, and hold the clearwell outlet if the site can.",
          skill: "controls",
        },
      },
      {
        code: "chlorine_residual_high",
        pointKey: "treated_cl2_residual_mgl",
        severity: "warning",
        category: "operations",
        message:
          "Treated water residual chlorine above the band — overdosing. The band is set per site " +
          "at commissioning.",
        philosophy: {
          cause:
            "A dosing controller holding a set point above demand, a flow-paced loop reading a " +
            "flow it is not seeing, or a dose left on manual after a demand event.",
          impact:
            "Taste and odour complaints, chlorinated by-products in the distributed water, and " +
            "hypochlorite consumed for nothing.",
          action:
            "Review the dosing set point and the flow pacing, return the loop to automatic, and " +
            "confirm the analyser reads the same as a hand-held test.",
          skill: "controls",
        },
      },
      {
        code: "filter_dp_high",
        pointKey: "filter_dp_bar",
        severity: "warning",
        category: "operations",
        message:
          "Filter head loss high — a backwash is due; run past it and breakthrough follows. The " +
          "limit is set per site at commissioning.",
        philosophy: {
          cause:
            "A normal filter run reaching its end, a coagulant overdose blinding the surface, or " +
            "media that has grown mudballs and lost its effective depth.",
          impact:
            "Head loss rising is the filter telling you the run is over. Pushed past it, the bed " +
            "sheds what it captured and the filtered turbidity alarm follows.",
          action:
            "Backwash the filter and watch the wash for media loss and mudballs; if head loss " +
            "returns early, the coagulant dose or the media itself is the cause.",
          skill: "mechanical",
        },
      },
      {
        code: "clearwell_level_low",
        pointKey: "clearwell_level_pct",
        severity: "critical",
        category: "operations",
        message:
          "Clear water reservoir level low — supply risk downstream. The level is set per site at " +
          "commissioning.",
        philosophy: {
          cause:
            "Draw above the plant's output, treatment held back for quality, an intake pump off " +
            "duty, or a leak on the reservoir or its outlet main.",
          impact:
            "The reservoir is the buffer between treatment and distribution. Empty, it also " +
            "shortens the chlorine contact time, so a supply problem becomes a disinfection " +
            "problem.",
          action:
            "Restore plant output, reduce draw if the site can, and inspect the reservoir and its " +
            "outlet main for a leak.",
          skill: "civil",
        },
      },
      {
        code: "intake_pump_trip",
        pointKey: "intake_pump_status",
        severity: "critical",
        category: "operations",
        message: "Raw water intake pump stopped — the plant has lost its feed.",
        philosophy: {
          cause:
            "A motor overload or thermal trip, a blocked intake screen, a lost suction or prime, " +
            "or a seized bearing or seal.",
          impact:
            "With no raw water there is no production, and the clear water reservoir drains at " +
            "the rate distribution draws it.",
          action:
            "Start the standby pump, then clear the intake screen and check suction, prime, " +
            "bearings and motor current before the duty machine returns to service.",
          skill: "mechanical",
        },
      },
    ],
    maintenance: [
      {
        title: "Filter media inspection and backwash performance check",
        category: "inspection_round",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 240,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Measure media depth, probe for mudballs, and watch a full backwash for bed expansion " +
          "and media carryover. filter_dp_bar and filtered_turbidity_ntu are the points the two " +
          "filter alarms bind; a bed that has lost depth passes both until it fails suddenly.",
      },
      {
        title: "Chlorine dosing service and residual analyser calibration",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 30,
        estimatedMinutes: 120,
        priority: "critical",
        safetyCritical: true,
        triggerSummary:
          "Service the dosing pump and its injection point, check the hypochlorite stock " +
          "strength, and calibrate the residual analyser against a hand-held test. Disinfection " +
          "is the barrier this plant exists to guarantee and treated_cl2_residual_mgl is the only " +
          "point that reports it, which is why this is the entry's one safetyCritical plan: an " +
          "analyser reading high is a disinfection failure nobody is told about.",
      },
      {
        title: "Clarifier scraper drive service and sludge draw check",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 180,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Service the scraper drive and gearbox, check the torque protection, and prove the " +
          "sludge draw-off works. clarifier_sludge_level_pct reports the blanket where a probe is " +
          "fitted; the drive that keeps it moving is reported by nothing.",
      },
      {
        title: "Turbidimeter calibration",
        category: "calibration",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 90,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Calibrate the raw, settled and filtered turbidimeters against formazin standards and " +
          "clean their flow cells. turbidity_removal_pct is computed from two of them, so a " +
          "drifted instrument moves a derived point as well as its own alarm.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "raw_water_flow_klh", label: "Raw water intake flow", unit: "KL/hr", required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "raw_turbidity_ntu", label: "Raw water turbidity", unit: "NTU", required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "raw_ph", label: "Raw water pH", unit: "pH", required: true, sortOrder: 2, meta: CORE },
    { ...MEASURED, pointKey: "settled_turbidity_ntu", label: "Clarifier outlet turbidity", unit: "NTU", required: false, sortOrder: 3, meta: EXTENDED },
    { ...MEASURED, pointKey: "filtered_turbidity_ntu", label: "Filter outlet turbidity", unit: "NTU", required: true, sortOrder: 4, meta: CORE },
    { ...MEASURED, pointKey: "filter_dp_bar", label: "Filter differential pressure / head loss", unit: "bar", required: true, sortOrder: 5, meta: CORE },
    { ...MEASURED, pointKey: "backwash_status", label: "Filter backwash in progress", unit: null, required: true, sortOrder: 6, meta: CORE },
    { ...MEASURED, pointKey: "coagulant_dose_lph", label: "Coagulant dosing rate", unit: "L/hr", required: false, sortOrder: 7, meta: EXTENDED },
    { ...MEASURED, pointKey: "chlorine_dose_lph", label: "Chlorine / hypo dosing rate", unit: "L/hr", required: false, sortOrder: 8, meta: EXTENDED },
    { ...MEASURED, pointKey: "treated_cl2_residual_mgl", label: "Treated water residual chlorine", unit: "mg/L", required: true, sortOrder: 9, meta: CORE },
    { ...MEASURED, pointKey: "treated_water_flow_klh", label: "Treated water outlet flow", unit: "KL/hr", required: true, sortOrder: 10, meta: CORE },
    { ...MEASURED, pointKey: "clearwell_level_pct", label: "Clear water reservoir level", unit: "%", required: true, sortOrder: 11, meta: CORE },
    { ...MEASURED, pointKey: "clarifier_sludge_level_pct", label: "Clarifier sludge blanket level", unit: "%", required: false, sortOrder: 12, meta: EXTENDED },
    { ...MEASURED, pointKey: "treated_conductivity_uscm", label: "Treated water conductivity", unit: "µS/cm", required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "intake_pump_current_a", label: "Intake pump motor current", unit: "A", required: true, sortOrder: 14, meta: CORE },
    { ...MEASURED, pointKey: "intake_pump_status", label: "Intake pump run status", unit: null, required: true, sortOrder: 15, meta: CORE },
    // The two M rows — entered by hand (F1.8 / F1.9), never mapped from a data
    // key. Hazen is a named colour scale and stays a unit, not "" — plan §12
    // ruling 3.
    { ...MEASURED, pointKey: "raw_color_hazen", label: "Raw water colour", unit: "Hazen", required: false, sortOrder: 16, meta: MANUAL },
    { ...MEASURED, pointKey: "raw_alkalinity_mgl", label: "Raw water alkalinity", unit: "mg/L", required: false, sortOrder: 17, meta: MANUAL },
    // Derived, appended after the table rows. No meta.tier: the C/X/M column
    // says what the plant has FITTED, and a computed point is fitted by nobody.
    // Both keep the 300 s default max input age — the inputs come from the same
    // controller at the same scan rate.
    {
      ...derived("{treated_water_flow_klh} / {raw_water_flow_klh} * 100"),
      pointKey: "recovery_pct",
      label: "Recovery (treated over raw)",
      unit: "%",
      required: false,
      sortOrder: 18,
    },
    {
      ...derived("(1 - {filtered_turbidity_ntu} / {raw_turbidity_ntu}) * 100"),
      pointKey: "turbidity_removal_pct",
      label: "Turbidity removal",
      unit: "%",
      required: false,
      sortOrder: 19,
    },
  ],
};
