import { CORE, EXTENDED, MANUAL, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The water pack's sewage-treatment-plant class — `E5.1`, ADR 0040 decision 1,
 * ADR 0052 decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/e5.1-derived-taglist-v1.md` §5 — *"STP — sewage treatment
 * plant (ASP / MBR)"*. PROVISIONAL: derived from published practice and the
 * client's own reference dashboards, not client-confirmed. The document is a
 * workshop handout whose own instruction to the client is *"strike what is not
 * fitted, add what is missing, correct names and units"*; the redline it comes
 * back as is `stockVersion` 2, never an edit to a shipped row (ADR 0015).
 *
 * **18 POINTS — 11 core + 5 extended + 2 manual + 0 derived**, §5's table rows
 * in the **document's own order**, which is what `sortOrder` follows. Tier `C`
 * is required and `meta.tier: "core"`; `X` is optional and `"extended"`; `M` is
 * optional and `"manual"`, entered by hand through `F1.8`/`F1.9` and never
 * mapped from a data key.
 *
 * **THE DUAL-TIER ROW, AND THE ONE PLACE IN THE PACK IT HAPPENS.**
 * `effluent_cod_mgl` is spelled `M/X` in §5 and `X/M` in §6. The rule is stated
 * once and applied twice: **the first-listed tier wins**, so this entry files it
 * `manual` and `water-etp` files the same code `extended`. Both are
 * `required: false`, so only `meta.tier` differs — and that is correct rather
 * than a clash, because `meta.tier` says what *that plant type* typically fits,
 * not what the code is. A sewage plant sends COD to a laboratory; an effluent
 * plant with a regulated discharge more often fits an online analyser. Both
 * entry specs assert their own half by name, because a single-entry assertion
 * would not show the disagreement is deliberate.
 *
 * **ZERO DERIVED POINTS, AND THAT IS A DECISION.** All four of §5's `D` codes
 * are deferred and named (ADR 0051 Amendment 6 decision 8: a code with no
 * `bms-calc-v1` formula is not vocabulary, and a deferral is never a
 * placeholder):
 *
 *  - `reuse_pct` — needs a reuse/recycle meter §5 does not list. *(The bullet
 *    that names it is a v2 redline candidate for the document.)*
 *  - `fm_ratio` — needs **influent** BOD, where §5 carries the effluent only,
 *    and the aeration tank volume, which is an asset attribute.
 *  - `specific_aeration_kwh_kl` — needs blower kWh; §5 declares
 *    `blower_current_a` and nothing converts a current to energy here.
 *  - `hydraulic_load_pct` — needs the design capacity, an asset attribute.
 *    Deferred on the ETP for the same reason.
 *
 * `recovery_pct` **is expressible** over `effluent_flow_klh` and
 * `influent_flow_klh` and is deliberately **not** authored (plan §12 ruling 7):
 * the STP's own derived quantity is *reuse*, a different number, and hydraulic
 * recovery shown where an operator expects reuse is the silent-wrong class of
 * failure. It is authored on the WTP and the RO, where recovery is the number
 * the plant is judged on.
 *
 * **NO `content.kpis` AT ALL**, and that is structural rather than a deferral
 * of effort (plan §5.0). Every ratio §5 names *and* the grammar can express is
 * a named derived code, so it would be a *point* and an alarm could bind it;
 * every ratio it names that the grammar cannot express is deferred. All four
 * are deferred, so there is nothing left for a KPI to be. The water pack
 * invents no KPI code and no point key.
 *
 * **ALARMS — 9, from §5's seven bullets.** DO splits into low and high (two
 * meanings, two responses), and *"effluent turbidity/TSS high"* splits into two
 * because this entry declares both points. Every row is **pair-absent** — no
 * `thresholdValue`, no `operator` (ADR 0019 Amendment 2, and the tag list's own
 * B7: *limit values are set per site at commissioning*) — and every row carries
 * a populated `philosophy` object, which ADR 0040 decision 4 requires of this
 * pack and which **no shipped electrical entry has**. That asymmetry is between
 * two ADRs and not a defect: ADR 0051 Amendment 6 did not ask for one, and
 * back-filling six shipped entries would be a `stockVersion` bump on each.
 *
 * **`philosophy.skill` is set on five rows and omitted on four** (plan §12
 * ruling 6). `bms.alarm_skills` (migration `0034`) holds `electrical`,
 * `mechanical`, `hvac`, `controls` and `civil` — and **no process trade**. So
 * `do_high` and `chlorine_residual_low` are `controls` (a control loop and a
 * dosing/analyser failure), `blower_trip` and `mbr_tmp_high` are `mechanical`
 * (a machine and a membrane stack), and `eq_tank_high` is `civil` (a tank and
 * its bund). **`do_low`, `mlss_out_of_band`, `effluent_turbidity_high` and
 * `effluent_tss_high` carry no `skill` at all**: they are process-chemistry
 * excursions answered by a plant operator, and routing one to Controls or
 * Mechanical would send the wrong person. A `process` skill is a separate
 * backlog row with its own migration; when it lands, those four rows gain a
 * skill in a `stockVersion` 2.
 *
 * **`effluent_tss_high` CARRIES NO NUMBER ANYWHERE**, including inside its
 * philosophy. Suspended solids is a **CPCB Schedule VI** discharge-consent
 * parameter: the consent value is per site and per consent, so this row carries
 * the *meaning* and never a limit (ADR 0040 decision 4). Its spec block asserts
 * the absence of a digit in the message and in all four philosophy strings,
 * because the pair-absence check cannot see inside a philosophy string.
 *
 * **THREE DECLARED ROWS CARRY NO ALARM, AND THAT IS A DECISION.**
 * `effluent_ph`, `effluent_bod_mgl` and `effluent_cod_mgl` are declared and
 * unalarmed, because §5's bullets name none of them. BOD and COD are laboratory
 * results that arrive days after the condition they describe, so an alarm on
 * them would fire against a plant state that no longer exists; pH is alarmed on
 * the ETP, where discharge pH is a consent condition, and §5 does not raise it
 * here. Recorded so the gap reads as a decision rather than an omission — the
 * same discipline `water-ro` uses for `cartridge_filter_dp_bar`.
 *
 * **MAINTENANCE — 4 plans, PROVISIONAL** (plan §12 ruling 5). The tag list has
 * no maintenance section at all, exactly as the electrical one had none, so
 * these are derived from **ASP/MBR operating practice**: the blower and
 * diffuser service that keeps aeration delivering, the weekly settleability and
 * solids round that sets the wasting rate, the membrane clean-in-place, and the
 * UV sleeve and lamp task. **None of the four is `safetyCritical`** — the
 * pack's three are the ETP guard pond, the cooling tower Legionella program and
 * the WTP chlorine dosing service. The MBR plan is the pack's only
 * `condition_based` one: it is generated in `condition` mode against
 * `mbr_tmp_bar`, and its `intervalDays` is the calendar backstop
 * `templateMaintenancePlanSchema` requires, not the intended trigger. The
 * asymmetry that makes authoring these safe is `F2.12`'s: a maintenance plan is
 * per-entry template content, changeable by a version bump, while a point key
 * is seeded into `bms.point_keys`, foreign-keyed by `0058` and permanent.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**, and the consequence is
 * real: the pattern is the site's telemetry wiring, which the tag list does not
 * know and the catalog must not guess, so **an imported draft cannot be
 * instantiated until an operator fills the patterns in** — a required point
 * with no resolvable key is a 400. The two `M` rows keep `null` forever by
 * design and land in `skippedPoints` at instantiation, so they never get an
 * `asset_points` row until `F1.8` manual entry gives them somewhere to write.
 *
 * `E5.1` pass B shipped this module as a skeleton carrying one placeholder
 * point; **pass C (this commit) replaced it with §5's full row set**, and no
 * placeholder remains in this file.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `water-stp` **v1** (2026-09-03, `E5.1`): authored from
 *    `e5.1-derived-taglist-v1.md` §5, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const WATER_STP: StockAssetTemplateEntry = {
  code: "water-stp",
  name: "Sewage treatment plant (ASP / MBR)",
  assetType: "stp",
  domain: "water",
  description:
    "Sewage treatment plant — activated sludge or MBR, with equalization, aeration, secondary " +
    "clarification and disinfection. Authored from docs/e5.1-derived-taglist-v1.md §5 " +
    "(PROVISIONAL — derived from published practice and the client's reference dashboards, not " +
    "client-confirmed). Tier C points are required, X optional, M entered by hand; alarm rows " +
    "carry a meaning and no limit, because a limit is set per site at commissioning. A plant " +
    "with no MBR stage or no UV stage strikes those rows at commissioning.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "do_low",
        pointKey: "aeration_do_mgl",
        severity: "critical",
        category: "operations",
        message:
          "Dissolved oxygen below the aeration band — the biology is at risk and nitrification " +
          "stops first. The band is set per site at commissioning.",
        philosophy: {
          cause:
            "Blower output below demand, a blinded or blocked diffuser grid, an incoming organic " +
            "load above design, or a dissolved-oxygen probe that has drifted since its last " +
            "calibration.",
          impact:
            "Nitrification stops before carbon removal does, so ammonia rises in the effluent " +
            "while BOD still looks acceptable. Held low, the sludge dies and the plant takes " +
            "days rather than a shift to recover.",
          action:
            "Confirm the reading against a hand-held meter, raise blower output or bring the " +
            "standby blower in, and inspect the diffuser grid for blinding. If the load is " +
            "genuinely above design, balance it through the equalization tank.",
        },
      },
      {
        code: "do_high",
        pointKey: "aeration_do_mgl",
        severity: "info",
        category: "energy",
        message:
          "Dissolved oxygen above the aeration band — the blower is running harder than the " +
          "process needs. The band is set per site at commissioning.",
        philosophy: {
          cause:
            "A dissolved-oxygen control loop holding a set point above the process requirement, " +
            "an air valve stuck open, or an incoming load well below design.",
          impact:
            "Aeration is the largest single energy consumer on an activated-sludge plant, so " +
            "every point above the band is paid for continuously and buys no treatment.",
          action:
            "Review the dissolved-oxygen set point and the loop tuning, and confirm the air " +
            "valve position matches its demand signal.",
          skill: "controls",
        },
      },
      {
        code: "mlss_out_of_band",
        pointKey: "mlss_mgl",
        severity: "warning",
        category: "operations",
        message:
          "Mixed liquor suspended solids outside the design band — a process upset, or sludge " +
          "wasting out of step with load. The band is set per site at commissioning.",
        philosophy: {
          cause:
            "Sludge wasted faster or slower than the incoming load needs, a return activated " +
            "sludge pump off its duty, or solids being lost over the clarifier weir.",
          impact:
            "Below the band the plant carries too little biomass to treat its load; above it the " +
            "clarifier is overloaded with solids and carryover follows within a shift.",
          action:
            "Compare against the sludge age and the settleability test, correct the wasting rate, " +
            "and confirm the return activated sludge flow is at its duty.",
        },
      },
      {
        code: "effluent_turbidity_high",
        pointKey: "effluent_turbidity_ntu",
        severity: "warning",
        category: "operations",
        message:
          "Effluent turbidity high — clarifier carryover, or a sludge blanket rising toward the " +
          "weir. The limit is set per site at commissioning.",
        philosophy: {
          cause:
            "A sludge blanket rising toward the weir, bulking or filamentous sludge that will not " +
            "settle, a hydraulic surge through the clarifier, or a return sludge pump off duty.",
          impact:
            "Solids leaving the clarifier carry organic load with them and shield organisms from " +
            "the disinfection step. Turbidity is the first visible sign that the discharge is " +
            "going out of specification.",
          action:
            "Read the clarifier blanket level, raise the return activated sludge flow or waste " +
            "sludge, and check the settleability of the mixed liquor.",
        },
      },
      {
        code: "effluent_tss_high",
        pointKey: "effluent_tss_mgl",
        severity: "critical",
        category: "safety",
        message:
          "Effluent suspended solids high. Suspended solids is a CPCB Schedule VI " +
          "discharge-consent parameter, so this row carries the meaning only — the consent value " +
          "is per site and per consent and is set at commissioning.",
        philosophy: {
          cause:
            "Sustained clarifier carryover, sludge bulking, or a filtration or membrane stage " +
            "passing solids it is there to retain.",
          impact:
            "Solids above the consent condition put the discharge outside the consent the site " +
            "holds. This is the parameter a regulator samples for, and the one that reaches an " +
            "inspection record.",
          action:
            "Take a grab sample and confirm it against the laboratory result, hold the discharge " +
            "in the treated tank if the site can, and correct the clarifier or the membrane stage " +
            "before the next consent sample is drawn.",
        },
      },
      {
        code: "chlorine_residual_low",
        pointKey: "effluent_cl2_residual_mgl",
        severity: "critical",
        category: "safety",
        message:
          "Disinfection residual below the site minimum — treated effluent is leaving without a " +
          "proven disinfection barrier. The minimum is set per site at commissioning.",
        philosophy: {
          cause:
            "A hypochlorite dosing pump that has lost prime or stopped, an empty or degraded " +
            "hypochlorite stock, a contact tank short-circuiting, or a residual analyser out of " +
            "calibration.",
          impact:
            "There is no proven barrier between the treated effluent and whatever it is " +
            "discharged to or reused for. On a reuse line that reaches people.",
          action:
            "Confirm the residual with a hand-held test, prove the dosing pump is delivering, and " +
            "check both the hypochlorite strength and the analyser calibration.",
          skill: "controls",
        },
      },
      {
        code: "blower_trip",
        pointKey: "blower_status",
        severity: "critical",
        category: "operations",
        message:
          "Air blower stopped — aeration is lost, and the biology begins to die within hours.",
        philosophy: {
          cause:
            "A motor overload or thermal trip, a seizing or overheating blower, a blocked inlet " +
            "filter, or a loss of supply to the blower panel.",
          impact:
            "Without air the aeration tank goes anaerobic. The sludge dies, the plant turns " +
            "septic and odorous, and recovery is measured in days.",
          action:
            "Start the standby blower first, then find why the duty machine tripped — inlet " +
            "filter, belts, bearings, motor current — before it is put back on duty.",
          skill: "mechanical",
        },
      },
      {
        code: "mbr_tmp_high",
        pointKey: "mbr_tmp_bar",
        severity: "warning",
        category: "operations",
        message:
          "Trans-membrane pressure rising — the membranes are fouling and a clean-in-place is " +
          "due. The limit is set per site at commissioning.",
        philosophy: {
          cause:
            "Organic or inorganic fouling of the membrane surface, insufficient air scour across " +
            "the stack, or sustained operation above the design flux.",
          impact:
            "Permeate flow falls and the permeate pump works harder for it. Run past the point " +
            "where cleaning still recovers the membrane and the fouling becomes permanent, which " +
            "is a re-membraning rather than a clean.",
          action:
            "Run the clean-in-place this condition triggers, confirm the air scour is delivering, " +
            "and hold flux down until the clean is complete.",
          skill: "mechanical",
        },
      },
      {
        code: "eq_tank_high",
        pointKey: "eq_tank_level_pct",
        severity: "critical",
        category: "safety",
        message:
          "Equalization tank approaching overflow — an untreated-sewage overflow is the failure " +
          "that reaches the regulator and the neighbours at once. The level is set per site at " +
          "commissioning.",
        philosophy: {
          cause:
            "Inflow above the plant's throughput, a transfer pump off duty, or a downstream stage " +
            "held back so the tank cannot be drawn down.",
          impact:
            "An overflow puts untreated sewage on the ground or into a drain — a consent breach, " +
            "a public-health exposure and a complaint, in one event.",
          action:
            "Bring the standby transfer pump in, reduce the inflow at source where that is " +
            "possible, and inspect the tank overflow route and its bund while the level is still " +
            "recoverable.",
          skill: "civil",
        },
      },
    ],
    maintenance: [
      {
        title: "Blower and diffuser service",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 180,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Service the duty and standby blowers — inlet filter, belts, bearings, lubrication and " +
          "motor current — and inspect the diffuser grid for blinding and an uneven bubble " +
          "pattern. Aeration is the plant's largest energy consumer, and blower_status is the " +
          "point the blower_trip alarm binds, so an unserviced machine is both an energy cost " +
          "and an alarm with nothing proven behind it.",
      },
      {
        title: "Sludge wasting and MLSS / SV30 round",
        category: "inspection_round",
        generationMode: "calendar",
        intervalDays: 7,
        estimatedMinutes: 60,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Run the settleability test and the mixed-liquor solids check, and set the period's " +
          "wasting rate from them. mlss_mgl is the point the mlss_out_of_band alarm binds; the " +
          "sludge volume index this round produces has no point key at all and stays on the " +
          "round sheet.",
      },
      {
        title: "MBR clean-in-place",
        category: "condition_based",
        generationMode: "condition",
        intervalDays: 180,
        estimatedMinutes: 480,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Clean the membranes in place when mbr_tmp_bar reaches the site's cleaning threshold. " +
          "The plan is condition_based and generated in condition mode for that reason; its " +
          "intervalDays is the calendar backstop templateMaintenancePlanSchema requires, not the " +
          "intended trigger. Struck at commissioning on a plant with no MBR stage, together with " +
          "the mbr_tmp_bar row.",
      },
      {
        title: "UV sleeve clean and lamp change",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 120,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Clean the quartz sleeves and change lamps at their rated life. uv_status reports that " +
          "the unit is running and not that it is delivering dose, so sleeve condition is the " +
          "part of UV disinfection only a physical round can prove. Struck at commissioning " +
          "where no UV stage is fitted.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "influent_flow_klh", label: "Influent flow", unit: "KL/hr", required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "effluent_flow_klh", label: "Treated effluent flow", unit: "KL/hr", required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "aeration_do_mgl", label: "Aeration tank dissolved oxygen", unit: "mg/L", required: true, sortOrder: 2, meta: CORE },
    { ...MEASURED, pointKey: "mlss_mgl", label: "Mixed liquor suspended solids", unit: "mg/L", required: true, sortOrder: 3, meta: CORE },
    { ...MEASURED, pointKey: "effluent_turbidity_ntu", label: "Effluent turbidity", unit: "NTU", required: true, sortOrder: 4, meta: CORE },
    { ...MEASURED, pointKey: "effluent_tss_mgl", label: "Effluent TSS", unit: "mg/L", required: false, sortOrder: 5, meta: EXTENDED },
    { ...MEASURED, pointKey: "effluent_ph", label: "Effluent pH", unit: "pH", required: true, sortOrder: 6, meta: CORE },
    { ...MEASURED, pointKey: "effluent_cl2_residual_mgl", label: "Disinfection residual chlorine", unit: "mg/L", required: true, sortOrder: 7, meta: CORE },
    // The two M rows — entered by hand (F1.8 / F1.9), never mapped from a data
    // key, so they land in skippedPoints at instantiation and carry no
    // asset_points row until manual entry exists. effluent_cod_mgl is §5's M/X
    // row: the first-listed tier wins, so it is manual here and extended on the
    // ETP. See the module docblock.
    { ...MEASURED, pointKey: "effluent_bod_mgl", label: "Effluent BOD", unit: "mg/L", required: false, sortOrder: 8, meta: MANUAL },
    { ...MEASURED, pointKey: "effluent_cod_mgl", label: "Effluent COD", unit: "mg/L", required: false, sortOrder: 9, meta: MANUAL },
    { ...MEASURED, pointKey: "blower_status", label: "Air blower run status", unit: null, required: true, sortOrder: 10, meta: CORE },
    { ...MEASURED, pointKey: "blower_current_a", label: "Blower motor current", unit: "A", required: true, sortOrder: 11, meta: CORE },
    { ...MEASURED, pointKey: "ras_flow_klh", label: "Return activated sludge flow", unit: "KL/hr", required: false, sortOrder: 12, meta: EXTENDED },
    { ...MEASURED, pointKey: "clarifier_sludge_level_pct", label: "Secondary clarifier blanket level", unit: "%", required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "eq_tank_level_pct", label: "Equalization tank level", unit: "%", required: true, sortOrder: 14, meta: CORE },
    { ...MEASURED, pointKey: "treated_tank_level_pct", label: "Treated water tank level", unit: "%", required: true, sortOrder: 15, meta: CORE },
    { ...MEASURED, pointKey: "mbr_tmp_bar", label: "MBR trans-membrane pressure", unit: "bar", required: false, sortOrder: 16, meta: EXTENDED },
    { ...MEASURED, pointKey: "uv_status", label: "UV disinfection status", unit: null, required: false, sortOrder: 17, meta: EXTENDED },
  ],
};
