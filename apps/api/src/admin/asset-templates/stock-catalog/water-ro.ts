import { CORE, derived, EXTENDED, MANUAL, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The water pack's reverse-osmosis class — `E5.1`, ADR 0040 decision 1,
 * ADR 0052 decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/e5.1-derived-taglist-v1.md` §2 — *"RO — reverse osmosis
 * skid"*. PROVISIONAL: derived from published practice, not client-confirmed.
 *
 * **`assetType` IS `ro_skid`**, the repository's existing spelling rather than
 * a new one — `asset-templates.instantiate.integration.spec.ts`'s fixtures
 * already use it beside `feeder`, `test_rig` and `test_skid`. Plan §12 ruling 4
 * confirmed it.
 *
 * **18 POINTS — 10 core + 5 extended + 1 manual + 2 DERIVED.** §2's 16 table
 * rows in the document's own order (`sortOrder` 0-15), then the two authored
 * derived codes (16-17).
 *
 * **THE TWO FORMULAS** (plan §5.0), both keeping the 300 s default
 * `maxInputAgeSeconds` because each takes both inputs from the skid's own
 * controller at the same scan rate:
 *
 *  - `recovery_pct` = `{permeate_flow_klh} / {feed_flow_klh} * 100`
 *  - `salt_rejection_pct` =
 *    `(1 - {permeate_conductivity_uscm} / {feed_conductivity_uscm}) * 100`
 *
 * **Division by zero is handled and must not be guarded**: `evaluate.ts`
 * returns `non_finite` for a non-finite result, so recovery at zero feed flow
 * and salt rejection at zero feed conductivity produce **no value for that
 * reading** rather than a wrong one. Do not add a `clamp` or a
 * `max(…, 0.001)` — a fabricated denominator turns "no data" into a plausible
 * number.
 *
 * **`recovery_pct` IS ONE CODE WITH TWO FORMULAS, AND THAT IS CORRECT, NOT A
 * CLASH.** `water-wtp` authors the same code as
 * `{treated_water_flow_klh} / {raw_water_flow_klh} * 100`. ADR 0051
 * Amendment 6 decision 5 rules **one code, one *meaning***, and the meaning is
 * identical on both plants — *the fraction of the input stream that leaves as
 * product*. Only the input names differ, exactly as `load_pct` means the same
 * thing on four electrical classes. The code is promoted **once** into the
 * vocabulary and authored **twice**, which is why `tests/f2.13` counts more
 * declared point rows than distinct keys. `water-classes-3.spec.ts` asserts
 * both formulas by name and asserts they differ, so a copy-paste of one entry
 * into the other is a build failure.
 *
 * The tag list writes the code `pct_recovery`; **the code is `recovery_pct`**
 * (plan §12 ruling 1 — ADR 0040 decision 2's `snake_case` plus unit-suffix
 * convention, and every other percentage in the vocabulary is `*_pct`). The
 * document's two rows are corrected in the closure `docs:` PR.
 *
 * **TWO DERIVED CODES ARE DEFERRED**, each for a different kind of reason:
 *
 *  - `specific_energy_kwh_kl` — needs the high-pressure pump's **kW**, and §2
 *    declares `hp_pump_current_a` only. Current is not power without voltage
 *    and power factor, neither of which this table carries. Already on the
 *    electrical pack's deferral ledger for the same reason, which is the
 *    per-entry `Record`'s whole point.
 *  - `normalized_permeate_flow` — the temperature-correction factor is an
 *    **exponential**, and `bms-calc-v1` has `+ - * /` and five functions
 *    (`abs`, `round`, `min`, `max`, `clamp`) and no `exp`. This is a grammar
 *    limit, not a data one, and no amount of instrumentation closes it.
 *
 * Named and never placeholdered (ADR 0051 Amendment 6 decision 8).
 *
 * **NO `content.kpis` AT ALL**, structurally rather than as a deferral of
 * effort (plan §5.0). `recovery_pct` is the proof: it is a ratio a KPI might
 * have carried, and **an alarm binds it**. A `content.kpis` entry cannot be
 * bound by an alarm, so a ratio an operator is paged about has to be a point.
 *
 * **ALARMS — 6, one per §2 bullet.** Nothing splits on this entry. Every row is
 * **pair-absent** — no `thresholdValue`, no `operator` (ADR 0019 Amendment 2,
 * and B7: *limit values are set per site at commissioning*) — and every row
 * carries a populated `philosophy`, which ADR 0040 decision 4 requires.
 *
 * Two bindings are worth stating because they are the ones a reader checks:
 * **`recovery_low` binds the DERIVED point `recovery_pct`** (the first alarm in
 * the catalog to bind a computed value on a non-tower entry), and **`sdi_high`
 * binds `feed_sdi`, an `M` row** — legal, because `assertContentRefsResolve`
 * requires the key to be *declared*, not required and not measured online. The
 * silt density index is a manual test, so that alarm fires on a value `F1.8`
 * manual entry writes.
 *
 * **`philosophy.skill` is set on four rows and omitted on two** (plan §12
 * ruling 6). `bms.alarm_skills` (migration `0034`) holds `electrical`,
 * `mechanical`, `hvac`, `controls` and `civil` — and no process trade. So
 * `permeate_conductivity_high`, `stage_dp_high` and `hp_pump_trip` are
 * `mechanical` (membranes, an element seal, a high-pressure pump) and
 * `feed_orp_high` is `controls` (an oxidant guard and its dosing loop).
 * **`recovery_low` and `sdi_high` carry none**: both are process judgements
 * about fouling and pre-treatment, answered by the plant operator or the
 * membrane vendor rather than by one of the five trades.
 *
 * **`cartridge_filter_dp_bar` IS DECLARED AND CARRIES NO ALARM, AND THAT IS A
 * DECISION.** §2's *"stage ΔP high"* bullet is singular and names the membrane
 * stage, so the cartridge pre-filter gets a **maintenance plan** rather than an
 * invented alarm row. Recorded so the gap reads as a decision and not an
 * omission; a second ΔP alarm is a v2 redline candidate for the document.
 * `cip_status`, `feed_ph`, `feed_temp_c`, `reject_flow_klh`,
 * `feed_pressure_bar`, `hp_pump_current_a` and `antiscalant_dose_lph` are
 * likewise declared and unalarmed, for the same reason: §2 names six alarm
 * bullets and this entry carries exactly those six.
 *
 * **MAINTENANCE — 4 plans, PROVISIONAL** (plan §12 ruling 5). Derived from
 * **membrane-plant OEM practice**: the clean-in-place, the cartridge pre-filter
 * change, the high-pressure pump service, and the probe calibration the two
 * derived points depend on. **None is `safetyCritical`** — the pack's three are
 * the ETP guard pond, the cooling tower Legionella program and the WTP chlorine
 * dosing service. The clean-in-place is `condition_based` and generated in
 * `condition` mode against `stage1_dp_bar`; its `intervalDays` is the calendar
 * backstop `templateMaintenancePlanSchema` requires, not the intended trigger.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the
 * site's telemetry wiring, which the tag list does not know and the catalog
 * must not guess, so an imported draft cannot be instantiated until an operator
 * fills the patterns in. `feed_sdi`, the one `M` row, keeps `null` forever by
 * design and lands in `skippedPoints`, so it never gets an `asset_points` row
 * until `F1.8` manual entry gives it somewhere to write — **and `sdi_high`
 * binds it**, which is the clearest statement in the pack of what an `M`-row
 * alarm is waiting on.
 *
 * `E5.1` pass B shipped this module as a skeleton carrying one placeholder
 * point; **pass C (this commit) replaced it with §2's full row set**, and no
 * placeholder remains in this file.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `water-ro` **v1** (2026-09-03, `E5.1`): authored from
 *    `e5.1-derived-taglist-v1.md` §2, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const WATER_RO: StockAssetTemplateEntry = {
  code: "water-ro",
  name: "Reverse osmosis skid",
  assetType: "ro_skid",
  domain: "water",
  description:
    "Reverse osmosis skid — cartridge pre-filtration, antiscalant dosing, a high-pressure pump " +
    "and the membrane array, with permeate and reject streams. Authored from " +
    "docs/e5.1-derived-taglist-v1.md §2 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required, X optional, M entered by hand; alarm rows " +
    "carry a meaning and no limit. Two derived points — recovery and salt rejection — are " +
    "computed from the measured rows and need no extra instrument.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "permeate_conductivity_high",
        pointKey: "permeate_conductivity_uscm",
        severity: "critical",
        category: "operations",
        message:
          "Permeate conductivity high — a membrane breach or an ageing element; product water is " +
          "off specification. The limit is set per site at commissioning.",
        philosophy: {
          cause:
            "A breached membrane leaf, a failed element or interconnector O-ring, oxidant damage " +
            "to the thin-film layer, or elements simply at the end of their life.",
          impact:
            "Product water goes off specification, and whatever the permeate feeds — a boiler, a " +
            "process, a polishing stage — inherits the salt the skid was installed to remove.",
          action:
            "Profile the array probe by probe to find the vessel at fault, check the " +
            "interconnector seals, and replace or re-seal the element before returning the skid " +
            "to service.",
          skill: "mechanical",
        },
      },
      {
        code: "recovery_low",
        pointKey: "recovery_pct",
        severity: "warning",
        category: "operations",
        message:
          "Recovery below the design point — fouling or scaling on the membrane. The design point " +
          "is set per site at commissioning.",
        philosophy: {
          cause:
            "Fouling or scaling on the membrane surface, antiscalant dosing off its duty, a feed " +
            "temperature below design, or a throttled reject valve left out of position.",
          impact:
            "More feed water is spent for the same product, so the reject stream and the energy " +
            "per unit of permeate both rise. Left alone, the fouling that caused it becomes the " +
            "cleaning that no longer recovers the membrane.",
          action:
            "Compare against feed temperature and pressure before assuming fouling, check the " +
            "antiscalant dose, and schedule a clean-in-place if the trend continues.",
        },
      },
      {
        code: "stage_dp_high",
        pointKey: "stage1_dp_bar",
        severity: "warning",
        category: "operations",
        message:
          "Stage differential pressure high — fouling; a clean-in-place is due. The limit is set " +
          "per site at commissioning.",
        philosophy: {
          cause:
            "Particulate or biological fouling in the feed channels, a failed cartridge pre-filter " +
            "letting solids through, or scaling at the tail of the stage.",
          impact:
            "Feed channels are closing. Run past the point where cleaning still recovers them and " +
            "the elements are replaced rather than washed.",
          action:
            "Run the clean-in-place this condition triggers, and check the cartridge pre-filter " +
            "and the feed silt density index for the source of the load.",
          skill: "mechanical",
        },
      },
      {
        code: "feed_orp_high",
        pointKey: "feed_orp_mv",
        severity: "critical",
        category: "safety",
        message:
          "Feed ORP high — free oxidant is reaching the membrane. The limit is set per site at " +
          "commissioning.",
        philosophy: {
          cause:
            "Chlorine or another oxidant breaking through from upstream treatment, a dechlorination " +
            "step exhausted or under-dosed, or an ORP electrode reading low until it was " +
            "recalibrated.",
          impact:
            "Thin-film composite membranes are destroyed by chlorine in hours, and the damage is " +
            "irreversible — this is the one alarm on the skid where the cost of waiting is a new " +
            "membrane set rather than a clean.",
          action:
            "Stop the feed, restore dechlorination — bisulphite dose or carbon bed — and confirm " +
            "with a hand-held test before the skid is restarted.",
          skill: "controls",
        },
      },
      {
        code: "hp_pump_trip",
        pointKey: "hp_pump_status",
        severity: "critical",
        category: "operations",
        message: "High-pressure pump stopped — the skid has stopped producing.",
        philosophy: {
          cause:
            "A motor overload or thermal trip, a low-suction or low-feed-pressure interlock, a " +
            "seized bearing or mechanical seal, or a variable-speed drive fault.",
          impact:
            "Production stops. If the pump stopped under load, the membranes also saw a pressure " +
            "transient, which is its own damage mechanism.",
          action:
            "Establish why the interlock or the overload operated before restarting; check " +
            "suction pressure, seals, bearings and drive fault history.",
          skill: "mechanical",
        },
      },
      {
        code: "sdi_high",
        pointKey: "feed_sdi",
        severity: "warning",
        category: "operations",
        message:
          "Silt density index high — the pre-treatment is failing and the membranes will foul. " +
          "The acceptance value is set per site at commissioning.",
        philosophy: {
          cause:
            "Upstream filtration or clarification passing solids, a cartridge pre-filter past its " +
            "life, or a change in the raw water the pre-treatment was designed for.",
          impact:
            "Every hour run at a high silt density index shortens the interval to the next " +
            "clean-in-place and, eventually, to a membrane replacement. The damage is cumulative " +
            "and invisible until the differential pressure reports it.",
          action:
            "Change the cartridge filters, check the upstream filtration, and repeat the test " +
            "before running the skid at full flow.",
        },
      },
    ],
    maintenance: [
      {
        title: "Membrane clean-in-place",
        category: "condition_based",
        generationMode: "condition",
        intervalDays: 180,
        estimatedMinutes: 480,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Clean the membranes in place when stage1_dp_bar rises past the site's cleaning " +
          "threshold, or when recovery_pct or permeate quality falls to it. The plan is " +
          "condition_based and generated in condition mode for that reason; its intervalDays is " +
          "the calendar backstop templateMaintenancePlanSchema requires, not the intended " +
          "trigger.",
      },
      {
        title: "Cartridge pre-filter change",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 60,
        estimatedMinutes: 90,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Change the cartridge pre-filters and record the differential pressure before and " +
          "after. cartridge_filter_dp_bar is declared and carries NO alarm — §2's stage ΔP bullet " +
          "names the membrane stage — so this plan is what keeps the pre-filter honest, and the " +
          "cartridge is also the first thing to check when sdi_high fires.",
      },
      {
        title: "HP pump service — seals, coupling and vibration",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 240,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Service the high-pressure pump: mechanical seal, coupling alignment, bearing " +
          "condition and a vibration reading against its baseline. hp_pump_status and " +
          "hp_pump_current_a report that it is running, not that it is healthy.",
      },
      {
        title: "Conductivity and pH probe calibration",
        category: "calibration",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 120,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Calibrate the feed and permeate conductivity cells, the feed pH electrode and the ORP " +
          "electrode. salt_rejection_pct is computed from two of those cells, so a drifted probe " +
          "moves a derived point as well as its own alarm — and feed_orp_mv reading low is the " +
          "failure that costs a membrane set.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "feed_flow_klh", label: "Feed water flow", unit: "KL/hr", required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "permeate_flow_klh", label: "Permeate flow", unit: "KL/hr", required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "reject_flow_klh", label: "Concentrate / reject flow", unit: "KL/hr", required: true, sortOrder: 2, meta: CORE },
    { ...MEASURED, pointKey: "feed_pressure_bar", label: "Feed pressure (post HP pump)", unit: "bar", required: true, sortOrder: 3, meta: CORE },
    { ...MEASURED, pointKey: "stage1_dp_bar", label: "Stage 1 differential pressure", unit: "bar", required: false, sortOrder: 4, meta: EXTENDED },
    { ...MEASURED, pointKey: "feed_conductivity_uscm", label: "Feed conductivity", unit: "µS/cm", required: true, sortOrder: 5, meta: CORE },
    { ...MEASURED, pointKey: "permeate_conductivity_uscm", label: "Permeate conductivity", unit: "µS/cm", required: true, sortOrder: 6, meta: CORE },
    { ...MEASURED, pointKey: "feed_ph", label: "Feed pH", unit: "pH", required: true, sortOrder: 7, meta: CORE },
    { ...MEASURED, pointKey: "feed_orp_mv", label: "Feed ORP (chlorine ingress guard)", unit: "mV", required: false, sortOrder: 8, meta: EXTENDED },
    { ...MEASURED, pointKey: "feed_temp_c", label: "Feed temperature", unit: "°C", required: true, sortOrder: 9, meta: CORE },
    { ...MEASURED, pointKey: "hp_pump_current_a", label: "High-pressure pump current", unit: "A", required: true, sortOrder: 10, meta: CORE },
    { ...MEASURED, pointKey: "hp_pump_status", label: "HP pump run status", unit: null, required: true, sortOrder: 11, meta: CORE },
    { ...MEASURED, pointKey: "cip_status", label: "Clean-in-place in progress", unit: null, required: false, sortOrder: 12, meta: EXTENDED },
    { ...MEASURED, pointKey: "antiscalant_dose_lph", label: "Antiscalant dosing rate", unit: "L/hr", required: false, sortOrder: 13, meta: EXTENDED },
    // The one M row — a manual test, never mapped from a data key. sdi_high
    // binds it, which is legal: the reference check requires the key to be
    // DECLARED, not required and not measured online.
    { ...MEASURED, pointKey: "feed_sdi", label: "Silt density index", unit: "SDI15", required: false, sortOrder: 14, meta: MANUAL },
    // Declared and deliberately unalarmed — §2's stage ΔP bullet is singular
    // and names the membrane stage. The pre-filter gets a maintenance plan.
    { ...MEASURED, pointKey: "cartridge_filter_dp_bar", label: "Cartridge pre-filter ΔP", unit: "bar", required: false, sortOrder: 15, meta: EXTENDED },
    // Derived, appended after the table rows. No meta.tier: the C/X/M column
    // says what the plant has FITTED, and a computed point is fitted by nobody.
    // recovery_pct is the SAME code water-wtp authors over its own streams —
    // one meaning, two formulas. See the module docblock.
    {
      ...derived("{permeate_flow_klh} / {feed_flow_klh} * 100"),
      pointKey: "recovery_pct",
      label: "Recovery (permeate over feed)",
      unit: "%",
      required: false,
      sortOrder: 16,
    },
    {
      ...derived("(1 - {permeate_conductivity_uscm} / {feed_conductivity_uscm}) * 100"),
      pointKey: "salt_rejection_pct",
      label: "Salt rejection",
      unit: "%",
      required: false,
      sortOrder: 17,
    },
  ],
};
