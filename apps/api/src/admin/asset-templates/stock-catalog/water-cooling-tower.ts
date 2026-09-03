import { CORE, derived, EXTENDED, MANUAL, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The water pack's cooling-tower class — `E5.1`, ADR 0040 decision 1,
 * ADR 0052 decisions 1, 2 and 6.
 *
 * **SOURCE.** `docs/e5.1-derived-taglist-v1.md` §4 — *"Cooling water / cooling
 * tower"*. PROVISIONAL: derived from published practice, not client-confirmed.
 *
 * **21 POINTS — 10 core + 6 extended + 1 manual + 4 DERIVED.** §4's 17 table
 * rows in the document's own order (`sortOrder` 0-16), then the four authored
 * derived codes (17-20). This is **the entry the derived machinery is first
 * proved on** in the water pack: four formulas, one `maxInputAgeSeconds`
 * override, and the first alarms anywhere in the catalog that bind a computed
 * point rather than a measured one.
 *
 * **THE FOUR FORMULAS** (plan §5.0), promoted into the vocabulary because they
 * are expressible over measured siblings *inside this entry* — ADR 0051
 * Amendment 6 decision 8: promote and author exactly the derived codes with an
 * in-entry formula, defer the rest by name:
 *
 *  - `range_c` = `{return_temp_c} - {supply_temp_c}` — how much heat the tower
 *    actually rejected.
 *  - `approach_c` = `{supply_temp_c} - {ambient_wetbulb_c}` — how close the
 *    tower got to the thermodynamic limit, which is the tower's own
 *    performance rather than the load's.
 *  - `cycles_of_concentration` =
 *    `{circ_conductivity_uscm} / {makeup_conductivity_uscm}` — the
 *    water-treatment program's headline ratio, dimensionless.
 *  - `makeup_pct` = `{makeup_flow_klh} / {circ_flow_klh} * 100`.
 *
 * **THREE CONSEQUENCES OF THOSE FORMULAS, STATED HERE RATHER THAN DISCOVERED
 * LATER.**
 *
 *  1. **Division by zero is handled, and must not be guarded.** `evaluate.ts`
 *     returns `non_finite` for any node whose result fails `Number.isFinite`,
 *     so `cycles_of_concentration` at zero make-up conductivity and
 *     `makeup_pct` at zero circulation both produce **no value for that
 *     reading** rather than a wrong one. **Do not add a `clamp` or a
 *     `max(…, 0.001)`**: a fabricated denominator turns "no data" into a
 *     plausible number, which is worse than a gap.
 *  2. **`approach_c` takes `maxInputAgeSeconds: 3600`, not the 300 s
 *     default** — the one override in the row, and the same call `F2.12` made
 *     for `oil_rise_over_ambient_c`. `ambient_wetbulb_c` commonly comes from a
 *     site weather station rather than the tower controller; at the default the
 *     formula silently never fires, which reads as *"the feature is broken"*
 *     and is the harder failure to diagnose. The other three take both inputs
 *     from the same controller at the same scan rate and keep the default.
 *  3. **Two formulas reference an `X`-tier optional point** — `approach_c`
 *     needs `ambient_wetbulb_c` and `cycles_of_concentration` needs
 *     `makeup_conductivity_uscm`. That is **legal**: the reference check
 *     requires the key to be *declared*, not required (ADR 0036 decision 7), so
 *     a site that does not fit the probe simply gets no value for that derived
 *     point. Correct behaviour — do not "fix" it by promoting the input to `C`.
 *
 * **ONE DERIVED CODE IS DEFERRED.** `evaporation_loss_klh`: the standard
 * estimate is *circulation × range × an empirical evaporation factor*, the
 * factor is unit-system- and site-specific, and the tag list gives none. A
 * fabricated coefficient is exactly the guessing ADR 0019 exists to prevent, so
 * the code is **named and never placeholdered**.
 *
 * **NO `content.kpis` AT ALL**, structurally rather than as a deferral of
 * effort (plan §5.0). `approach_c` and `cycles_of_concentration` are the proof:
 * both are ratios a KPI might have carried, and **both are bound by alarms**.
 * A `content.kpis` entry cannot be bound by an alarm, so a ratio an operator is
 * paged about has to be a point. Every expressible ratio §4 names is therefore
 * a point, and the one it names that the grammar cannot express is deferred —
 * which leaves nothing for a KPI to be.
 *
 * **ALARMS — 7, from §4's five bullets.** *"cycles low / high"* splits into two
 * (two opposite meanings: below the target the site blows down more than the
 * chemistry needs and pays for make-up water; above it the condenser tubes
 * scale) and *"fan/pump trip"* splits into two (two machines, two responses).
 * Two rows bind `cycles_of_concentration` at opposite bands, exactly as the
 * feeder binds `voltage_vry` twice for under- and over-voltage. Every row is
 * **pair-absent** — no `thresholdValue`, no `operator` (ADR 0019 Amendment 2,
 * and B7: *limit values are set per site at commissioning*; here they are set
 * with the water-treatment program) — and every row carries a populated
 * `philosophy`, which ADR 0040 decision 4 requires of this pack.
 *
 * **`philosophy.skill` is set on five rows and omitted on two** (plan §12
 * ruling 6). `bms.alarm_skills` (migration `0034`) holds `electrical`,
 * `mechanical`, `hvac`, `controls` and `civil` — and **no process trade**, and
 * no chemistry one. So `approach_high`, `fan_trip` and `circ_pump_trip` are
 * `mechanical` (fill, drift eliminators, a fan drive, a pump), `cycles_low` is
 * `controls` (a conductivity controller and a blowdown valve holding the wrong
 * set point) and `basin_level_low` is `civil` (a basin and its make-up).
 * **`cycles_high` and `ph_out_of_program_band` carry no `skill`**: both are
 * water-chemistry program questions answered by the treatment vendor or the
 * plant chemist, and `hvac` — the nearest seeded trade to a cooling tower — is
 * the air-side trade and would be the wrong person. When a `process` skill
 * lands they gain one in a `stockVersion` 2.
 *
 * **NO CPCB CONSENT ROW.** Unlike the STP and the ETP, nothing on a cooling
 * tower is a discharge-consent parameter — blowdown goes to the site's own
 * effluent plant, where `water-etp`'s consent rows carry that meaning. This
 * entry therefore has no digit-free-text rule to hold beyond the pack's general
 * "no limit value anywhere".
 *
 * **MAINTENANCE — 4 plans, PROVISIONAL** (plan §12 ruling 5). The tag list has
 * no maintenance section, so these are derived from **cooling-tower
 * water-treatment program practice**: the basin and drift-eliminator round, the
 * biocide dose check and Legionella sampling, the fan drive service, and the
 * conductivity controller and blowdown valve calibration that the two cycles
 * alarms depend on. **The biocide program and Legionella sampling is the only
 * `safetyCritical` plan on this entry** — a cooling tower is an aerosol
 * generator and Legionella control is a public-health barrier, which is why it
 * and not the fan service carries the flag. It is one of the pack's three,
 * beside the ETP's guard pond and the WTP's chlorine dosing service.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the
 * site's telemetry wiring, which the tag list does not know and the catalog
 * must not guess, so an imported draft cannot be instantiated until an operator
 * fills the patterns in. `circ_tds_mgl`, the one `M` row, keeps `null` forever
 * by design and lands in `skippedPoints`, so it never gets an `asset_points`
 * row until `F1.8` manual entry gives it somewhere to write.
 *
 * `E5.1` pass B shipped this module as a skeleton carrying one placeholder
 * point; **pass C (this commit) replaced it with §4's full row set**, and no
 * placeholder remains in this file.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `water-cooling-tower` **v1** (2026-09-03, `E5.1`): authored from
 *    `e5.1-derived-taglist-v1.md` §4, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const WATER_COOLING_TOWER: StockAssetTemplateEntry = {
  code: "water-cooling-tower",
  name: "Cooling tower / cooling water circuit",
  assetType: "cooling_tower",
  domain: "water",
  description:
    "Cooling tower and its circulating water circuit — basin, make-up and blowdown, fans, " +
    "circulation pumps and the water-treatment program. Authored from " +
    "docs/e5.1-derived-taglist-v1.md §4 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required, X optional, M entered by hand; alarm rows " +
    "carry a meaning and no limit, because the bands are set per site with the water-treatment " +
    "program. Four derived points — range, approach, cycles of concentration and make-up as a " +
    "percentage of circulation — are computed from the measured rows and need no extra " +
    "instrument.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "approach_high",
        pointKey: "approach_c",
        severity: "warning",
        category: "energy",
        message:
          "Approach to wet-bulb widening — the tower's thermal performance is degraded. The " +
          "target approach is a design figure set per site at commissioning.",
        philosophy: {
          cause:
            "Fouled or collapsed fill, blocked drift eliminators, a fan not making design " +
            "airflow, or water distribution that has gone uneven across the cells.",
          impact:
            "The tower returns warmer water than it was designed to, so every chiller or process " +
            "it serves works harder for the same duty. Approach is the tower's own performance, " +
            "measured against the thermodynamic limit rather than against the load.",
          action:
            "Inspect the fill, the drift eliminators and the distribution nozzles, and check fan " +
            "pitch, belt tension and airflow before assuming the load has changed.",
          skill: "mechanical",
        },
      },
      {
        code: "cycles_low",
        pointKey: "cycles_of_concentration",
        severity: "info",
        category: "energy",
        message:
          "Cycles of concentration below the program target — the tower is blowing down more " +
          "than the chemistry needs, and paying for make-up water to replace it. The target is " +
          "set with the water-treatment program.",
        philosophy: {
          cause:
            "A conductivity controller set point below the program's, a blowdown valve passing " +
            "or stuck open, or a conductivity probe reading high because it is fouled.",
          impact:
            "Water and the chemicals dissolved in it go to drain for no benefit. On a large " +
            "circuit this is a continuous and invisible cost, which is why the row is filed under " +
            "energy rather than operations.",
          action:
            "Check the conductivity controller set point against the program, prove the blowdown " +
            "valve closes, and clean and calibrate the conductivity probe.",
          skill: "controls",
        },
      },
      {
        code: "cycles_high",
        pointKey: "cycles_of_concentration",
        severity: "warning",
        category: "operations",
        message:
          "Cycles of concentration above the program target — scaling risk on the condenser " +
          "tubes. Both cycles bands are per site, set with the water-treatment program.",
        philosophy: {
          cause:
            "Blowdown not opening or restricted, a conductivity probe reading low, or make-up " +
            "water harder than the program was written for.",
          impact:
            "Dissolved solids concentrate past what the inhibitor program can hold in solution, " +
            "and scale forms on the condenser tubes — which costs heat transfer first and a " +
            "cleaning outage later.",
          action:
            "Prove the blowdown valve opens and the line is clear, calibrate the conductivity " +
            "probe, and review the make-up water quality with the treatment vendor.",
        },
      },
      {
        code: "ph_out_of_program_band",
        pointKey: "circ_ph",
        severity: "warning",
        category: "operations",
        message:
          "Circulating water pH outside the treatment program's band — corrosion below it, scale " +
          "above it. The band is set with the water-treatment program.",
        philosophy: {
          cause:
            "Acid or inhibitor dosing off its duty, a process leak into the circuit, high cycles " +
            "driving alkalinity up, or a pH electrode out of calibration.",
          impact:
            "Below the band the circuit corrodes and the inhibitor film is lost; above it " +
            "carbonate scale forms. Both damage the same surfaces the tower exists to protect, " +
            "from opposite directions.",
          action:
            "Confirm the reading against a hand-held meter, check the dosing lines, and look for " +
            "a process leak into the circuit before adjusting the program.",
        },
      },
      {
        code: "basin_level_low",
        pointKey: "basin_level_pct",
        severity: "critical",
        category: "operations",
        message:
          "Basin level low — the circulation pump is at risk of losing suction. The level is set " +
          "per site at commissioning.",
        philosophy: {
          cause:
            "Make-up water unavailable or its valve failed shut, a basin or circuit leak, " +
            "blowdown stuck open, or drift and evaporation above what make-up is replacing.",
          impact:
            "The circulation pump loses suction, cavitates and trips, and the cooling loop stops " +
            "with the load still on it. A basin run dry also damages the pump itself.",
          action:
            "Restore make-up, check the make-up valve and the float, and walk the basin and the " +
            "circuit for a leak while there is still level to work with.",
          skill: "civil",
        },
      },
      {
        code: "fan_trip",
        pointKey: "fan_status",
        severity: "warning",
        category: "operations",
        message:
          "Tower cell fan stopped — that cell contributes no cooling, and the approach widens " +
          "behind it.",
        philosophy: {
          cause:
            "A motor overload or thermal trip, a broken or slipping belt, a gearbox fault, or " +
            "vibration cut-out from an unbalanced or iced fan.",
          impact:
            "The cell reverts to natural draught and rejects a fraction of its design heat. On a " +
            "multi-cell tower the loss shows up as a widening approach before anybody notices the " +
            "cell itself is off.",
          action:
            "Isolate and inspect the drive — belt, coupling, gearbox oil, bearings and blade " +
            "balance — and confirm the vibration cut-out before restarting.",
          skill: "mechanical",
        },
      },
      {
        code: "circ_pump_trip",
        pointKey: "circ_pump_status",
        severity: "critical",
        category: "operations",
        message:
          "Circulation pump stopped — the cooling loop has lost flow, and the load it serves is " +
          "next.",
        philosophy: {
          cause:
            "A motor overload, a lost suction from low basin level, a seized bearing or seal, or " +
            "a closed valve on the circuit.",
          impact:
            "Without circulation there is no heat rejection at all. Whatever the loop serves — a " +
            "chiller, a compressor, a process exchanger — trips on high temperature within " +
            "minutes.",
          action:
            "Start the standby pump, then find the cause: basin level, suction strainer, seals " +
            "and bearings, and the valve line-up on the circuit.",
          skill: "mechanical",
        },
      },
    ],
    maintenance: [
      {
        title: "Basin clean-out and drift-eliminator inspection",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 480,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Drain, clean and refill the basin, and inspect the fill, the drift eliminators and the " +
          "distribution nozzles. Sludge in the basin is where biofilm establishes, and blocked " +
          "eliminators are one of the causes the approach_high alarm reports.",
      },
      {
        title: "Biocide program dose check and Legionella sampling",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 30,
        estimatedMinutes: 90,
        priority: "critical",
        safetyCritical: true,
        triggerSummary:
          "Confirm the biocide program is dosing to plan and draw the Legionella sample. A " +
          "cooling tower is an aerosol generator, so this is a public-health barrier and not a " +
          "water-quality nicety — which is why it and not the fan service is this entry's one " +
          "safetyCritical plan. circ_orp_mv reports biocide residual where the probe is fitted; " +
          "the sample result itself has no point key and stays with the laboratory report.",
      },
      {
        title: "Fan gearbox, belt and motor service",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 240,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Service each cell's drive — gearbox oil, belt tension and condition, bearings, blade " +
          "pitch and balance, and motor current against nameplate. fan_status and fan_current_a " +
          "are the points the fan_trip alarm and the approach diagnosis depend on.",
      },
      {
        title: "Conductivity controller and blowdown valve calibration",
        category: "calibration",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 120,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Clean and calibrate the circulating and make-up conductivity probes and prove the " +
          "blowdown valve strokes fully in both directions. cycles_of_concentration is computed " +
          "from those two probes, so a drifted probe moves the derived point and both cycles " +
          "alarms with it — the calibration is what keeps a computed number honest.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "supply_temp_c", label: "Cold (basin/supply) water temperature", unit: "°C", required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "return_temp_c", label: "Hot (return) water temperature", unit: "°C", required: true, sortOrder: 1, meta: CORE },
    // X-tier and referenced by approach_c — legal, and deliberate. A site with
    // no wet-bulb sensor gets no approach value; see the module docblock.
    { ...MEASURED, pointKey: "ambient_wetbulb_c", label: "Ambient wet-bulb temperature", unit: "°C", required: false, sortOrder: 2, meta: EXTENDED },
    { ...MEASURED, pointKey: "circ_flow_klh", label: "Circulation flow", unit: "KL/hr", required: true, sortOrder: 3, meta: CORE },
    { ...MEASURED, pointKey: "makeup_flow_klh", label: "Make-up water flow", unit: "KL/hr", required: true, sortOrder: 4, meta: CORE },
    { ...MEASURED, pointKey: "blowdown_flow_klh", label: "Blowdown flow", unit: "KL/hr", required: false, sortOrder: 5, meta: EXTENDED },
    { ...MEASURED, pointKey: "basin_level_pct", label: "Basin level", unit: "%", required: true, sortOrder: 6, meta: CORE },
    { ...MEASURED, pointKey: "circ_conductivity_uscm", label: "Circulating water conductivity", unit: "µS/cm", required: true, sortOrder: 7, meta: CORE },
    // X-tier and referenced by cycles_of_concentration — the second legal
    // optional input.
    { ...MEASURED, pointKey: "makeup_conductivity_uscm", label: "Make-up water conductivity", unit: "µS/cm", required: false, sortOrder: 8, meta: EXTENDED },
    { ...MEASURED, pointKey: "circ_ph", label: "Circulating water pH", unit: "pH", required: true, sortOrder: 9, meta: CORE },
    { ...MEASURED, pointKey: "circ_orp_mv", label: "Circulating water ORP (biocide control)", unit: "mV", required: false, sortOrder: 10, meta: EXTENDED },
    { ...MEASURED, pointKey: "fan_status", label: "Fan run status (per cell)", unit: null, required: true, sortOrder: 11, meta: CORE },
    { ...MEASURED, pointKey: "fan_current_a", label: "Fan motor current", unit: "A", required: false, sortOrder: 12, meta: EXTENDED },
    { ...MEASURED, pointKey: "circ_pump_status", label: "Circulation pump run status", unit: null, required: true, sortOrder: 13, meta: CORE },
    { ...MEASURED, pointKey: "circ_pump_current_a", label: "Circulation pump current", unit: "A", required: true, sortOrder: 14, meta: CORE },
    { ...MEASURED, pointKey: "inhibitor_dose_lph", label: "Corrosion/scale inhibitor dosing", unit: "L/hr", required: false, sortOrder: 15, meta: EXTENDED },
    // The one M row — a laboratory TDS, entered by hand, never mapped.
    { ...MEASURED, pointKey: "circ_tds_mgl", label: "Circulating TDS", unit: "mg/L", required: false, sortOrder: 16, meta: MANUAL },
    // Derived, appended after the table rows. No meta.tier: the C/X/M column
    // says what the plant has FITTED, and a computed point is fitted by nobody.
    {
      ...derived("{return_temp_c} - {supply_temp_c}"),
      pointKey: "range_c",
      label: "Range (return minus supply)",
      unit: "°C",
      required: false,
      sortOrder: 17,
    },
    // 3600 s and not the 300 s default: ambient_wetbulb_c commonly comes from a
    // site weather station rather than the tower controller, and at the default
    // this formula silently never fires. See the module docblock.
    {
      ...derived("{supply_temp_c} - {ambient_wetbulb_c}", { maxInputAgeSeconds: 3600 }),
      pointKey: "approach_c",
      label: "Approach to wet-bulb",
      unit: "°C",
      required: false,
      sortOrder: 18,
    },
    {
      ...derived("{circ_conductivity_uscm} / {makeup_conductivity_uscm}"),
      pointKey: "cycles_of_concentration",
      label: "Cycles of concentration",
      unit: null,
      required: false,
      sortOrder: 19,
    },
    {
      ...derived("{makeup_flow_klh} / {circ_flow_klh} * 100"),
      pointKey: "makeup_pct",
      label: "Make-up as a percentage of circulation",
      unit: "%",
      required: false,
      sortOrder: 20,
    },
  ],
};
