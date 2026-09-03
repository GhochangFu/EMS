import { CORE, derived, EXTENDED, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The mechanical pack's air-compressor class — `E5.2`, ADR 0053 decisions 1-8,
 * ADR 0052 decisions 1, 2 and 6, ADR 0019 Amendment 2.
 *
 * **SOURCE.** `docs/e5.2-derived-taglist-v1.md` §3 — *"Air compressor — rotary
 * screw, with dryer"*. PROVISIONAL: derived from published practice, not
 * client-confirmed. The section's own basis line is what a **compressor
 * controller display actually exposes** — the Elektronikon / Sigma / Neuron
 * register set, which is what a Modbus gateway on a screw compressor reads back
 * — so the twenty-one rows are the machine's own instrument list and not a wish
 * list. The dryer travels with the machine here (its dew point and its run
 * status are two of the rows) because on a packaged installation it is one
 * skid; a separately mounted dryer is a redline candidate for v2.
 *
 * **23 POINTS — 8 core + 13 extended + 0 manual + 2 DERIVED.** §3's 21 table
 * rows in the document's own order (`sortOrder` 0-20), then the two authored
 * derived codes (21-22). No `M` row: everything a compressor knows about itself,
 * its controller already reports.
 *
 * **SIX OF THE TWENTY-ONE ROWS ARE REUSED CODES, REFERENCED AND NEVER
 * REDECLARED** (ADR 0053 decision 3):
 *
 *  - `oil_temp_c` and `oil_pressure_bar` — **the DG set's codes**, with exactly
 *    the same meaning: lubrication oil in a running machine, its temperature and
 *    its pressure. A `comp_oil_temp_c` pair would be a second code for one
 *    meaning (ADR 0051 Amendment 6 decision 5), and on an oil-injected screw the
 *    oil circuit is the machine's cooling as well as its lubrication, which is
 *    the same fact a generator's is.
 *  - `run_hours_h`, `kw`, `kwh_total` — the counters and the electrical rows the
 *    pump already names.
 *  - `service_due_h` — the controller's own hours-to-next-service counter, which
 *    counts DOWN. This is why the `service_due` alarm on this entry binds
 *    `service_due_h` while the pump's alarm of the same code binds `run_hours_h`:
 *    a screw compressor's controller keeps the countdown and a pump's starter
 *    does not. An alarm code is unique within an entry only, so the reuse is
 *    legal, and the two bindings are deliberately different.
 *
 * Units in `bms.point_keys` are **write-once** (`seedPointKeyCatalog` inserts
 * with `COALESCE`), so a second declaration could not correct one anyway. Each
 * code stays in the array that already holds it; the compressor names it.
 *
 * **THE TWO FORMULAS** (plan §5.0), promoted into the vocabulary because a
 * derived point's `pointKey` passes `assertPointKeysActive` like any other:
 *
 *  - `load_factor_pct` = `{loaded_hours_h} / {run_hours_h} * 100` — the ratio of
 *    loaded to running hours, **and it is a LIFETIME ratio**, which is exactly
 *    what the document names. `bms-calc-v1` has arithmetic, parentheses and five
 *    functions and no state at all, so a rolling or a shift load factor is not
 *    expressible here and is not what this point is. Read as a lifetime figure
 *    it is still the single most useful number a compressed-air audit starts
 *    from: a machine that has run mostly unloaded has been paying for air it
 *    never made. Both inputs are tier C, so unlike the pump's two formulas this
 *    one computes on every compressor the template is imported onto.
 *  - `specific_power_kw_m3min` = `{kw} * 60 / {fad_m3h}` — kilowatts per cubic
 *    metre per minute of free air, the figure every compressed-air audit and
 *    every OEM data sheet is written in. **The `* 60` is a unit conversion and
 *    not a physical constant**: §3's FAD row is `m³/hr` and the industry's
 *    specific power is per minute. Both inputs are tier X, so a house with no
 *    air-flow meter simply gets no value — legal, because the reference check
 *    requires a key to be DECLARED and not required (ADR 0036 decision 7). Do
 *    not "fix" it by promoting `fad_m3h` to C: most installed compressors have
 *    no flow meter, and a required point with a null pattern is a 400 at
 *    instantiation.
 *
 * **DIVISION BY ZERO IS HANDLED AND MUST NOT BE GUARDED.** `evaluate.ts` returns
 * `non_finite` for a node whose result fails `Number.isFinite`, so load factor
 * before the machine's first run hour, and specific power at zero FAD or with no
 * flow meter fitted, produce **no value for that reading**. No `clamp`, no
 * `max(…, 0.001)`: a fabricated denominator turns "no data" into a plausible
 * number, and a plausible wrong specific power is exactly the number somebody
 * will put in a savings case. **Neither formula overrides `maxInputAgeSeconds`**:
 * all four inputs come from the same controller at the same scan rate, well
 * inside the 300 s default. The entry spec asserts `null` on both.
 *
 * **TWO DERIVED CODES ARE DEFERRED AND NAMED, never placeholdered** (ADR 0053
 * decision 6; ADR 0051 Amendment 6 decision 8 — a code with no `bms-calc-v1`
 * formula is not vocabulary). `stock-catalog-deferrals.spec.ts` holds the list
 * and asserts this entry declares neither:
 *
 *  - **A time window the grammar has no state for** — `unload_cycles_per_hour`.
 *    Load/unload transitions per hour is the number that says whether a fixed-
 *    speed machine is badly matched to its demand, and it is a rate over a
 *    window. `comp_load_state` is the row a rule counts transitions on (`E2.4`),
 *    the same way the pump's `short_cycling` binds `start_count`.
 *  - **A method the document only names, a class NEW in this pack** —
 *    `air_leak_estimate_pct`. A no-demand pressure-decay test is a PROCEDURE: it
 *    needs a window in which nothing on site draws air, the machines loaded to a
 *    known pressure and then stopped, and the decay timed. Its inputs are not
 *    points and its precondition is an operational state nobody can assert from
 *    telemetry. The leak survey belongs in the maintenance regime, not in a
 *    formula, and a plausible computed leak percentage would be worse than none.
 *
 * **NO `content.kpis`** (ADR 0053 decision 6, the same structural reason
 * `water.ts` and `mechanical.ts` record). Both expressible ratios §3 names are
 * declared codes, so both are points; the two the grammar cannot express are
 * deferred. There is nothing left for a KPI to be — and a `content.kpis` entry
 * could not be bound by an alarm in any case.
 *
 * **ALARMS — 7, one per §3 bullet.** The only entry in the pack where nothing
 * splits and nothing merges. Every row is **pair-absent** — no `thresholdValue`,
 * no `operator` (ADR 0019 Amendment 2, and B7: limit values are set per site at
 * commissioning) — and every row carries a populated ADR 0019 §3 `philosophy`,
 * which ADR 0053 decision 5 requires of this pack.
 *
 * **TWO ROWS ARE NOT `operations`, AND THE CATEGORIES CARRY MEANING.**
 * `element_outlet_temp_high` is **`safety`**: on an oil-injected screw the
 * element outlet temperature is the fire-risk trip — carbonised oil in a hot
 * element is how an air end catches fire — and filing it beside a filter change
 * would put a fire precursor in the operations bucket. `separator_dp_high` is
 * **`energy`**: a loaded separator element makes the machine produce more
 * pressure than the header needs, every hour it runs, and that is a continuous
 * cost rather than an event. The other five are `operations`.
 *
 * **`philosophy.skill` is `mechanical` on all seven.** An air end, a separator
 * element, an intake filter, an oil circuit, a dryer and a service interval are
 * all the mechanical trade's, and unlike the pump there is no motor-band row for
 * `electrical` and no controller-logic row for `controls` — the compressor's own
 * controller answers its load/unload logic without anybody's help. **This entry
 * has no process-chemistry row**: all four of the pack's no-skill rows are the
 * boiler's, and the entry spec passes an empty list, which is a claim rather
 * than a gap because `assertSkillAssignment` requires the map and the list to
 * partition the seven.
 *
 * **MAINTENANCE — 4 plans, PROVISIONAL** (plan §12 ruling 5), derived from the
 * Elektronikon service intervals and general rotary-screw practice, because the
 * tag list has no maintenance section.
 *
 * **ONE IS `safetyCritical` — the pressure-relief valve test**, the first of
 * exactly three ADR 0053 decision 8 names for this pack (the other two are the
 * AHU's fire-trip interlock test and the boiler's low-water cut-off and
 * safety-valve test). A receiver and an air end are pressure vessels; the relief
 * valve is the last barrier when the controller's own pressure control fails,
 * and a relief valve that has never been lifted is a relief valve nobody knows
 * the state of. It is `safety_critical` at `critical` priority for that reason.
 *
 * **Two of the four are `runtime_based` in `runtime` mode**, keyed on the hour
 * counters the controller reports — which is how a screw compressor's schedule
 * is actually kept. A runtime plan is not a condition plan wearing another name:
 * it generates on accumulated hours, not on a measured value crossing a band,
 * and **this entry carries no `condition_based` plan at all**.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the site's
 * telemetry wiring — here, the controller register the integrator mapped — which
 * the tag list does not know and the catalog must not guess. An imported draft
 * cannot be instantiated until an operator fills the patterns in.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `mechanical-compressor` **v1** (2026-09-03, `E5.2`): authored from
 *    `e5.2-derived-taglist-v1.md` §3, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const MECHANICAL_COMPRESSOR: StockAssetTemplateEntry = {
  code: "mechanical-compressor",
  name: "Air compressor (rotary screw, with dryer)",
  assetType: "air_compressor",
  domain: "mechanical",
  description:
    "Rotary-screw air compressor and its dryer — run and load state, outlet and receiver " +
    "pressure, element outlet and oil temperatures, the intake filter and oil separator " +
    "pressure drops, the running and loaded hour counters, free air delivery and the dryer's " +
    "dew point. The rows are what a compressor controller already displays, so a Modbus gateway " +
    "on the machine reads most of them without new instruments. Authored from " +
    "docs/e5.2-derived-taglist-v1.md §3 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required and X optional; alarm rows carry a meaning " +
    "and no limit, because the bands are set per site at commissioning. Two derived points — " +
    "load factor and specific power — are computed from the measured rows, and specific power is " +
    "the figure every compressed-air audit is written in.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "compressor_shutdown",
        pointKey: "comp_fault",
        severity: "critical",
        category: "operations",
        message:
          "Controller shutdown — the compressor has stopped on its own protection and the plant " +
          "air header has lost a machine.",
        philosophy: {
          cause:
            "Any of the controller's own trips: element outlet temperature, oil pressure, motor " +
            "overload, a phase or supply fault, a separator or filter differential beyond its " +
            "limit, or a sensor the controller can no longer read.",
          impact:
            "Header pressure falls at whatever rate the site's demand exceeds the remaining " +
            "machines. Compressed air is a utility that almost every process on a plant depends " +
            "on quietly, so the consequences appear somewhere other than the compressor house — " +
            "actuators that will not stroke, instruments that lose their supply, a dryer that " +
            "stops regenerating.",
          action:
            "Read the shutdown reason on the controller before resetting; the machine records " +
            "which protection acted and what the readings were. Bring a standby machine on to " +
            "hold the header while the cause is found, and do not reset repeatedly — a trip that " +
            "returns is a trip with a cause still in place.",
          skill: "mechanical",
        },
      },
      {
        code: "element_outlet_temp_high",
        pointKey: "element_outlet_temp_c",
        severity: "critical",
        category: "safety",
        message:
          "Compression element outlet temperature high. The band is set per site at " +
          "commissioning, from the OEM's own figure for the machine and the oil in it. This row " +
          "is filed as a safety concern rather than an operations one, and the philosophy says " +
          "why.",
        philosophy: {
          cause:
            "Loss of oil cooling — a low oil level, a blocked or fouled oil cooler, a thermostatic " +
            "valve stuck, an oil filter that has bypassed, the wrong oil grade, or a hot and " +
            "poorly ventilated compressor room feeding the cooler with air it cannot use.",
          impact:
            "On an oil-injected screw this is the FIRE-RISK trip and not a performance one: the " +
            "oil carries the heat of compression away, and oil left too hot for too long " +
            "carbonises in the element and in the separator. A carbon deposit in a hot element " +
            "with a continuous supply of compressed air is how an air end catches fire, which is " +
            "why the row is critical, categorised safety, and never to be filed beside a filter " +
            "change.",
          action:
            "Let the machine trip rather than overriding it. Check the oil level, the cooler and " +
            "the thermostatic valve, and check the room's ventilation and inlet temperature " +
            "before restarting; a compressor room that has warmed up over a season is a common " +
            "cause and one nobody at the machine can see.",
          skill: "mechanical",
        },
      },
      {
        code: "outlet_pressure_low",
        pointKey: "outlet_pressure_bar",
        severity: "warning",
        category: "operations",
        message:
          "Air outlet pressure below the header's demand with the machine running. The pressure " +
          "band is set per site at commissioning, against the site's own load and setpoint.",
        philosophy: {
          cause:
            "Demand that has grown past the installed capacity, a leak on the distribution ring, " +
            "a machine unloading early because a setpoint has drifted, a worn air end, or a " +
            "blocked intake filter starving the element.",
          impact:
            "Every pneumatic actuator and instrument on the site is running below its design " +
            "supply, so faults appear as slow cylinders, valves that do not seat and " +
            "intermittent instrument failures far from the compressor house. A site that answers " +
            "this by raising the setpoint pays for the extra pressure on every hour of every " +
            "machine.",
          action:
            "Look for the leak before adding capacity: a leak survey on a no-demand window is " +
            "usually the cheapest air a site ever buys. Then check the intake filter, the " +
            "setpoints of every machine on the header, and whether the load has genuinely grown.",
          skill: "mechanical",
        },
      },
      {
        code: "intake_filter_dp_high",
        pointKey: "intake_filter_dp_mbar",
        severity: "warning",
        category: "operations",
        message:
          "Air intake filter differential pressure high — the filter is loaded and a change is " +
          "due. The differential is set per site at commissioning, from the OEM's figure.",
        philosophy: {
          cause:
            "A dust-loaded intake filter, which is what happens in the ordinary course of a " +
            "machine's life and faster in a dusty plant, and sooner still if the intake draws " +
            "from the wrong side of the compressor room.",
          impact:
            "The element has to pull against the filter, so the machine makes less air for the " +
            "same power and the outlet pressure falls with it. A filter left long past its " +
            "change also risks a collapse and dust straight into the air end, which is a repair " +
            "and not a service.",
          action:
            "Change the element rather than cleaning it, and note whether the interval is " +
            "shortening — a filter that loads faster each time is telling you where the intake " +
            "is drawing from.",
          skill: "mechanical",
        },
      },
      {
        code: "separator_dp_high",
        pointKey: "oil_separator_dp_bar",
        severity: "warning",
        category: "energy",
        message:
          "Oil separator differential pressure high — the separator element is loaded. The " +
          "differential is set per site at commissioning. This row is filed as an energy concern " +
          "rather than an operations one, and the philosophy says why.",
        philosophy: {
          cause:
            "A separator element at the end of its life, oil degraded past its service interval, " +
            "or the wrong oil grade — all of which load the element with what it was meant to " +
            "separate.",
          impact:
            "The element has to make the separator's differential ON TOP of the header pressure " +
            "for every cubic metre of air, every hour the machine runs. It is a CONTINUOUS " +
            "energy cost rather than an event, which is why the row is energy and not operations: " +
            "nothing fails today, and the machine quietly spends more for the same air until " +
            "somebody changes the element. Carried far enough it also passes oil downstream into " +
            "the air.",
          action:
            "Change the separator element and the oil together, and check the oil's condition " +
            "rather than only its hours — the two service intervals are related, and an element " +
            "loading early is usually an oil that was left in too long.",
          skill: "mechanical",
        },
      },
      {
        code: "dewpoint_high",
        pointKey: "dryer_dewpoint_c",
        severity: "warning",
        category: "operations",
        message:
          "Dryer outlet pressure dew point high — wet air is going downstream. The dew point is " +
          "set per site at commissioning, from the driest point the plant's own use demands.",
        philosophy: {
          cause:
            "A refrigerant dryer short of charge or with a fouled condenser, a desiccant dryer " +
            "with exhausted or contaminated media or a failed changeover valve, a drain trap " +
            "passing or blocked, or simply an inlet air temperature and flow above what the " +
            "dryer was sized for.",
          impact:
            "Water in the distribution ring rusts the pipe, carries scale into every actuator " +
            "and instrument, and freezes in any line that runs outside. Pneumatic instrument " +
            "faults caused by wet air appear as instrument faults and are almost never diagnosed " +
            "at the dryer.",
          action:
            "Check the drains first — a blocked or a passing trap is the commonest cause and the " +
            "cheapest fix — then the dryer's own condition and the inlet temperature. A dryer " +
            "correct for the winter is often undersized for the summer inlet.",
          skill: "mechanical",
        },
      },
      {
        code: "service_due",
        pointKey: "service_due_h",
        severity: "info",
        category: "operations",
        message:
          "The controller's hours-to-next-service counter has reached its limit. This alarm binds " +
          "the CONTROLLER's own countdown, service_due_h, and not the cumulative run hours: the " +
          "pump's alarm of the same code binds run_hours_h because a pump's starter has no such " +
          "counter.",
        philosophy: {
          cause:
            "The machine has simply run its hours. This is a scheduled-work row and not a fault " +
            "row, which is why it is filed as info.",
          impact:
            "Air and oil filters, the separator element and the oil itself are consumables on a " +
            "running-hour basis. Service deferred long enough stops being maintenance and " +
            "becomes the separator, element-temperature and dew-point alarms above — in that " +
            "order, and the last of them is the fire-risk one.",
          action:
            "Raise the service against the runtime plans on this template and reset the " +
            "controller's own counter once the work is signed off, so the countdown and the " +
            "record agree.",
          skill: "mechanical",
        },
      },
    ],
    maintenance: [
      {
        title: "Air filter, oil filter and separator element service",
        category: "runtime_based",
        generationMode: "runtime",
        intervalDays: 90,
        estimatedMinutes: 180,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Change the air intake filter, the oil filter and the oil separator element on the " +
          "controller's hours, keyed on run_hours_h and the countdown the machine keeps on " +
          "service_due_h — which is what the service_due alarm binds. The plan is runtime_based " +
          "and generated in runtime mode for that reason; its intervalDays is the calendar " +
          "backstop templateMaintenancePlanSchema requires, not the intended trigger. A " +
          "separator left past its interval shows up first as separator_dp_high, which is a " +
          "continuous energy cost rather than a failure.",
      },
      {
        title: "Oil change and oil analysis",
        category: "runtime_based",
        generationMode: "runtime",
        intervalDays: 180,
        estimatedMinutes: 120,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Change the compressor oil to the OEM grade on the controller's hours and send a " +
          "sample for analysis. On an oil-injected screw the oil is the machine's cooling as " +
          "well as its lubrication, so degraded oil raises element_outlet_temp_c and loads the " +
          "separator at the same time; the analysis is what says whether the interval is right " +
          "for this machine's duty and this room's temperature.",
      },
      {
        title: "Pressure-relief valve test",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 60,
        priority: "critical",
        safetyCritical: true,
        triggerSummary:
          "Lift and prove the relief valves on the air receiver and on the compressor package, " +
          "and record the result. The receiver and the air end are pressure vessels, and the " +
          "relief valve is the LAST barrier when the controller's own pressure control fails — a " +
          "valve that has never been lifted is a valve nobody knows the state of, because it " +
          "sits in the same wet, oily air that fouls everything else on the machine. This is one " +
          "of exactly three safetyCritical plans in the pack (ADR 0053 decision 8); the other " +
          "two are the AHU's fire-trip interlock test and the boiler's low-water cut-off and " +
          "safety-valve test.",
      },
      {
        title: "Dryer service and dew-point check",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 90,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Service the dryer to its own schedule — clean the condenser or change the desiccant " +
          "and its filters, prove the drain traps discharge and do not pass, and verify the " +
          "outlet pressure dew point against dryer_dewpoint_c. A blocked or passing drain trap " +
          "is the commonest cause of the dewpoint_high alarm and the cheapest thing on the skid " +
          "to fix.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "comp_status", label: "Run status", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "comp_load_state", label: "Stopped / unloaded / loaded", unit: null, required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "comp_fault", label: "Shutdown / fault active", unit: null, required: true, sortOrder: 2, meta: CORE },
    { ...MEASURED, pointKey: "comp_warning", label: "Warning active (service, temperature)", unit: null, required: false, sortOrder: 3, meta: EXTENDED },
    { ...MEASURED, pointKey: "outlet_pressure_bar", label: "Air outlet (discharge) pressure", unit: "bar", required: true, sortOrder: 4, meta: CORE },
    { ...MEASURED, pointKey: "pressure_setpoint_bar", label: "Load / unload setpoint", unit: "bar", required: false, sortOrder: 5, meta: EXTENDED },
    // The fire-risk row on an oil-injected screw — element_outlet_temp_high is
    // categorised `safety` for the reason its philosophy gives.
    { ...MEASURED, pointKey: "element_outlet_temp_c", label: "Compression element outlet temperature", unit: "°C", required: true, sortOrder: 6, meta: CORE },
    // Reused ● — the DG set's two lubrication-oil codes, one meaning, one code.
    // Referenced, never redeclared: units are seeded write-once.
    { ...MEASURED, pointKey: "oil_temp_c", label: "Oil / oil-injection temperature", unit: "°C", required: false, sortOrder: 7, meta: EXTENDED },
    { ...MEASURED, pointKey: "oil_pressure_bar", label: "Oil pressure", unit: "bar", required: false, sortOrder: 8, meta: EXTENDED },
    // mbar on the intake filter and bar on the separator — the two differentials
    // are three orders of magnitude apart and the document spells both.
    { ...MEASURED, pointKey: "intake_filter_dp_mbar", label: "Air intake filter ΔP", unit: "mbar", required: false, sortOrder: 9, meta: EXTENDED },
    { ...MEASURED, pointKey: "oil_separator_dp_bar", label: "Oil separator ΔP", unit: "bar", required: false, sortOrder: 10, meta: EXTENDED },
    // The two cumulative counters load_factor_pct divides — both tier C, so the
    // formula computes on every machine the template is imported onto.
    { ...MEASURED, pointKey: "run_hours_h", label: "Total running hours", unit: "h", required: true, sortOrder: 11, meta: CORE },
    { ...MEASURED, pointKey: "loaded_hours_h", label: "Loaded hours", unit: "h", required: true, sortOrder: 12, meta: CORE },
    { ...MEASURED, pointKey: "motor_current_a", label: "Main motor current", unit: "A", required: true, sortOrder: 13, meta: CORE },
    // X-tier and referenced by specific_power_kw_m3min — legal, and deliberate.
    { ...MEASURED, pointKey: "kw", label: "Input power", unit: "kW", required: false, sortOrder: 14, meta: EXTENDED },
    { ...MEASURED, pointKey: "kwh_total", label: "Cumulative energy", unit: "kWh", required: false, sortOrder: 15, meta: EXTENDED },
    { ...MEASURED, pointKey: "dryer_dewpoint_c", label: "Dryer outlet pressure dew point", unit: "°C", required: false, sortOrder: 16, meta: EXTENDED },
    { ...MEASURED, pointKey: "dryer_status", label: "Dryer run status", unit: null, required: false, sortOrder: 17, meta: EXTENDED },
    { ...MEASURED, pointKey: "receiver_pressure_bar", label: "Air receiver pressure", unit: "bar", required: false, sortOrder: 18, meta: EXTENDED },
    // X-tier and the second input of specific_power_kw_m3min: most installed
    // compressors have no flow meter, so this row stays optional on purpose.
    { ...MEASURED, pointKey: "fad_m3h", label: "Free air delivery", unit: "m³/hr", required: false, sortOrder: 19, meta: EXTENDED },
    // Reused ● — the controller's own countdown, which the service_due alarm
    // binds here (the pump's alarm of the same code binds run_hours_h).
    { ...MEASURED, pointKey: "service_due_h", label: "Hours to next service", unit: "h", required: false, sortOrder: 20, meta: EXTENDED },
    // Derived, appended after the table rows. No meta.tier: the C/X/M column
    // says what the plant has FITTED, and a computed point is fitted by nobody.
    // A LIFETIME ratio of two cumulative counters — what the document names, and
    // all bms-calc-v1 can express, because the grammar has no state.
    {
      ...derived("{loaded_hours_h} / {run_hours_h} * 100"),
      pointKey: "load_factor_pct",
      label: "Load factor (loaded ÷ running hours)",
      unit: "%",
      required: false,
      sortOrder: 21,
    },
    // The `* 60` converts the document's m³/hr FAD into the m³/min the industry
    // writes specific power in — a unit conversion, not a physical constant.
    {
      ...derived("{kw} * 60 / {fad_m3h}"),
      pointKey: "specific_power_kw_m3min",
      label: "Specific power",
      unit: "kW/(m³/min)",
      required: false,
      sortOrder: 22,
    },
  ],
};
