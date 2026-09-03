import { CORE, derived, EXTENDED, MANUAL, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The mechanical pack's water-cooled chiller class — `E5.2`, ADR 0053 decisions
 * 1-11, ADR 0052 decisions 1, 2 and 6, ADR 0019 Amendment 2.
 *
 * **THE FIRST STOCK ENTRY EVER FILED UNDER `hvac`.** Its `domain` is `"hvac"`
 * and not `"mechanical"`, because ADR 0053 decision 2 files an entry under the
 * domain its keys already live in and nine of §4's codes are `HVAC_POINT_KEYS`
 * or `hvac`-filed vocabulary. The module lives under `mechanical.ts` all the
 * same: `PACK_SOURCE_DOC` is keyed by code PREFIX and a pack is one DOCUMENT,
 * and the two are different axes. One document feeds both prefixes; do not tidy
 * this file into an `hvac.ts` that would need its own provenance story.
 *
 * **SOURCE.** `docs/e5.2-derived-taglist-v1.md` §4 — *"Chiller — water-cooled
 * centrifugal/screw (air-cooled: drop the CW rows)"*. PROVISIONAL: derived from
 * published practice, not client-confirmed. §4 calls this **the N5 asset** and
 * aligns its names with Haystack's `chiller` equip and ASHRAE Guideline 36's
 * chiller-plant variables, *"so the KPI library (`kw_per_tr`, `cop`) can be
 * authored once"* — which is exactly what the five derived points below are.
 *
 * **THE AIR-COOLED VARIANT IS A REDLINE, NOT A SECOND ENTRY.** §4's own title
 * says an air-cooled machine is this table minus the condenser-water rows, so a
 * site with air-cooled chillers strikes `cw_entering_temp_c`,
 * `cw_leaving_temp_c`, `cw_flow_lps` and `cw_delta_t_c` from its imported draft.
 * Minting an `hvac-chiller-air-cooled` would be two entries drifting apart on
 * every later correction; the workshop handout is where the strike happens.
 *
 * **THE COOLING TOWER IS `water-cooling-tower`, AND IT IS NOT FORKED** (ADR 0053
 * decision 1). §5 of this tag list is the tower and carries no table because
 * `E5.1` already shipped it. A chiller plant **composes** that entry — the
 * chiller, its tower, its primary and secondary pumps and their VFDs are
 * separate assets in one asset group at one location (decision 9) — so nothing
 * here restates a tower's rows and no `hvac-cooling-tower` is minted. A
 * parent-child plant is a v2 shape behind `F2.10`.
 *
 * **30 POINTS — 13 core + 11 extended + 1 manual + 5 DERIVED.** §4's 25 table
 * rows in the document's own order (`sortOrder` 0-24), then the five authored
 * derived codes (25-29) in the order §4's own *Derived:* line names them:
 * `cooling_load_tr`, `kw_per_tr`, `cop`, then the two ΔTs.
 *
 * **TEN OF THE TWENTY-FIVE ROWS ARE REUSED CODES — the most of any entry in the
 * pack — REFERENCED AND NEVER REDECLARED** (ADR 0053 decision 3):
 *
 *  - `chw_supply_temp_c`, `chw_return_temp_c`, `chw_flow_lps`, `compressor_ok`,
 *    `cooling_kw` — five of `HVAC_POINT_KEYS`'s nine codes, which the seeded
 *    `BASELINE-HVAC` template, `rule-points.ts`, `control-room-bindings.ts` and
 *    the CRAC screens all consume today. **This is why the pack's new HVAC codes
 *    went into a SEPARATE array** (`HVAC_CLASS_POINT_KEYS`): `hvacPointKeySchema`
 *    is a closed `z.enum(HVAC_POINT_KEYS)`, and widening the nine would have
 *    reached every one of those consumers for no benefit here.
 *  - `kwh_total`, `run_hours_h`, `start_count` — the counters the pump and the
 *    compressor already name; `start_count` is what `compressor_short_cycling`
 *    binds.
 *  - `oil_pressure_bar`, `oil_temp_c` — the DG set's lubrication-oil pair, the
 *    same two codes the compressor reuses, with the same meaning on a
 *    refrigeration compressor.
 *
 * Units in `bms.point_keys` are **write-once** (`seedPointKeyCatalog` inserts
 * with `COALESCE`), so a second declaration could not correct one anyway. Each
 * code stays in the array that already holds it; the chiller names it.
 *
 * **`cond_approach_c` IS NOT `E5.1`'s TOWER `approach_c`.** The tower's approach
 * is computed there from a wet-bulb input; this row is **controller-reported**,
 * §4 says so, and it is the condenser's own refrigerant-to-water approach — the
 * direct measure of tube fouling. Two different quantities on two different
 * assets, and two codes is correct.
 *
 * **THE FIVE FORMULAS — the N4 form's KPIs** (plan §5.0), promoted into the
 * vocabulary because a derived point's `pointKey` passes `assertPointKeysActive`
 * like any other. **Every input is tier C**, so unlike the pump's and the
 * compressor's formulas all five compute on every chiller the template is
 * imported onto:
 *
 *  - `chw_delta_t_c` = `{chw_return_temp_c} - {chw_supply_temp_c}` — the plant
 *    loop ΔT at the machine. A chiller running at a low ΔT is moving more water
 *    than it needs to for the load it is carrying, which is the "low delta-T
 *    syndrome" every chilled-water plant paper is written about.
 *  - `cw_delta_t_c` = `{cw_leaving_temp_c} - {cw_entering_temp_c}` — the
 *    condenser-water ΔT, and the row an air-cooled machine strikes.
 *  - `cooling_load_tr` =
 *    `{chw_flow_lps} * ({chw_return_temp_c} - {chw_supply_temp_c}) * 4.19 / 3.517`
 *    — the delivered cooling in tons of refrigeration. **`4.19` and `3.517` are
 *    the DOCUMENT's own constants**, written in §4's *Derived:* line: 4.19
 *    kJ/kg·K is the specific heat of water (so L/s × K × 4.19 is kW) and 3.517
 *    kW is one ton of refrigeration. They are physics, not site values — B7
 *    governs alarm thresholds, not constants — and they are the only numbers in
 *    this entry outside a `sortOrder`.
 *  - `kw_per_tr` =
 *    `{cooling_kw} * 3.517 / ({chw_flow_lps} * ({chw_return_temp_c} - {chw_supply_temp_c}) * 4.19)`
 *    — the specific power, and **the number a chiller plant is judged on**.
 *  - `cop` =
 *    `{chw_flow_lps} * ({chw_return_temp_c} - {chw_supply_temp_c}) * 4.19 / {cooling_kw}`
 *    — the coefficient of performance, which is the same information as kW/TR
 *    the other way up (§4 writes it as 3.517 ÷ kW/TR). Dimensionless, so its
 *    catalogue unit is the empty string and its template unit is `null`.
 *
 * **`kw_per_tr` AND `cop` RESTATE THE ΔT, AND THAT IS REQUIRED RATHER THAN
 * CLUMSY.** A derived point may reference only MEASURED points of the same entry
 * (ADR 0036 decision 7, enforced by `validateFormula`), never another derived
 * point — so `{cooling_kw} * 3.517 / {cooling_load_tr}` does not parse at all,
 * and `{chw_delta_t_c}` inside a denominator does not parse either. The
 * restatement is the only expressible form. **Do not "simplify" it**: the entry
 * spec asserts all five strings literally, because a rewrite of a shipped
 * formula is a silent behaviour change on every organization that imported the
 * entry, and two valid formulas over the same inputs can mean opposite things.
 *
 * **DIVISION BY ZERO IS HANDLED AND MUST NOT BE GUARDED.** `evaluate.ts` returns
 * `non_finite` for a node whose result fails `Number.isFinite`, so `kw_per_tr` at
 * zero ΔT or zero flow, and `cop` on a chiller that is off — `cooling_kw` zero —
 * produce **no value for that reading**. That is the correct answer: a chiller
 * that is not running has no efficiency, and a fabricated denominator would put
 * a plausible kW/TR on a stopped machine, straight into the trend the N5 signal
 * reads. No `clamp`, no `max(…, 0.001)`. **None of the five overrides
 * `maxInputAgeSeconds`**: the temperatures and the flow come from the chiller's
 * own controller and `cooling_kw` from a power meter, and both report inside the
 * 300 s default. The entry spec asserts `null` on all five.
 *
 * **TWO DERIVED CODES ARE DEFERRED AND NAMED, never placeholdered** (ADR 0053
 * decision 6; ADR 0051 Amendment 6 decision 8). `stock-catalog-deferrals.spec.ts`
 * holds the list and asserts this entry declares neither:
 *
 *  - **A time window** — `approach_trend`. A trend is a window by definition, and
 *    the grammar has no state. `cond_approach_c` is the point; the trend over it
 *    is the rule's (`E2.4`) and the tube-clean plan's.
 *  - **An asset attribute** — `part_load_pct`, which is `cooling_load_tr` over
 *    the machine's **rated** TR. The rating is on the nameplate and the nameplate
 *    is not a point.
 *
 * **NO `content.kpis`, AND ON THIS ENTRY THAT IS THE WHOLE ARGUMENT** (ADR 0053
 * decision 6). §4's KPIs are exactly what a `content.kpis` block looks like it is
 * for — and authoring them there would have made `kw_per_tr_high` impossible,
 * because an alarm binds a declared POINT and `collectContentPointRefs` walks a
 * KPI's key list without ever making it bindable. A named derived code is a
 * point, a point can carry an alarm, and the N5 health signal is that alarm.
 * **Chiller-health analytics is still not built here** (decision 11): `kw_per_tr`
 * is a point, `kw_per_tr_high` is a pair-absent alarm meaning, and the health
 * model over them is the surface ADR 0050 owns.
 *
 * **ALARMS — 9, one per §4 bullet.** Every row is **pair-absent** — no
 * `thresholdValue`, no `operator` (ADR 0019 Amendment 2, and B7: limit values are
 * set per site at commissioning) — and every row carries a populated ADR 0019 §3
 * `philosophy`, which ADR 0053 decision 5 requires of this pack.
 *
 * **TWO ROWS ARE `energy` AND SEVEN ARE `operations`** (plan §12 ruling 6).
 * `cond_approach_high` and `kw_per_tr_high` are both about a machine that still
 * makes its chilled water and spends more doing it — a continuous cost rather
 * than an event — while the other seven stop, threaten or degrade the duty.
 * **`chw_leaving_temp_high` is `operations` and NOT `comfort`**: the AHU's three
 * comfort rows serve occupants directly, and a chiller serves a loop whose load
 * it does not know.
 *
 * **`philosophy.skill` is `hvac` ON EIGHT OF THE NINE.** A refrigeration circuit,
 * an evaporator, a condenser and a compressor's oil system are all the HVAC
 * trade's. The exception is `compressor_short_cycling`, which is **`controls`**:
 * starts accumulating faster than the machine is rated for is a setpoint dead
 * band, a staging sequence or a loop hunting, and the machine itself is healthy —
 * the same call the pump's `short_cycling` row makes. **This entry has no
 * process-chemistry row**: all four of the pack's no-skill rows are the boiler's,
 * and the entry spec passes an empty list, which is a claim rather than a gap.
 *
 * **`compressor_short_cycling` BINDS THE CUMULATIVE COUNTER `start_count`**, as
 * the pump's row does. §4's bullet is *"compressor starts-per-hour high"*; a
 * per-hour rate is not expressible, so the alarm binds the counter and its text
 * says the rate is the rule's to evaluate.
 *
 * **VENDOR FAULT CODES ARE CARRIED IN THE TEXT, NEVER ENUMERATED.**
 * `chiller_fault_code` is declared as a `code` row with an empty catalogue unit
 * and no alarm binds it; `chiller_alarm` binds the `0/1` flag beside it. Note the
 * tier: this row is **X** where the VFD's equivalent is **C**, which is the
 * document's own split and is not to be normalised — a chiller controller carries
 * its own alarm text on the panel and a drive does not.
 *
 * **MAINTENANCE — 4 plans, PROVISIONAL** (plan §12 ruling 5), derived from
 * chiller-OEM practice, because the tag list has no maintenance section. **None
 * is `safetyCritical`**: ADR 0053 decision 8 names exactly three in the pack and
 * none of them is here. The first is `condition_based` in `condition` mode and
 * names `cond_approach_c`, the point whose rise is its trigger; its
 * `intervalDays` is the calendar backstop `templateMaintenancePlanSchema`
 * requires, not the intended trigger. **The fourth is the pack's first
 * `calibration` plan and it is the one that keeps a computed KPI honest**: three
 * of this entry's five derived points are only as true as the two temperatures,
 * the flow and the power meter behind them, and a drifted flow meter produces a
 * confident kW/TR that is simply false — with no symptom anywhere, because the
 * point is computed.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the site's
 * telemetry wiring, which the tag list does not know and the catalog must not
 * guess, so an imported draft cannot be instantiated until an operator fills the
 * patterns in. `refrigerant_charge_pct`, the one `M` row, keeps `null` forever by
 * design — a charge level is read with the machine down and written on a sheet —
 * so it always lands in `skippedPoints` and never gets an `asset_points` row
 * until `F1.8` manual entry gives it somewhere to write.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `hvac-chiller` **v1** (2026-09-03, `E5.2`): authored from
 *    `e5.2-derived-taglist-v1.md` §4, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const HVAC_CHILLER: StockAssetTemplateEntry = {
  code: "hvac-chiller",
  name: "Chiller (water-cooled)",
  assetType: "chiller",
  domain: "hvac",
  description:
    "Water-cooled centrifugal or screw chiller — the chilled-water and condenser-water " +
    "temperatures and flows with their setpoint, the refrigerant pressures and approaches, the " +
    "compressor's load, current and oil circuit, and the machine's energy and hour counters. An " +
    "air-cooled machine is the same table with the condenser-water rows struck. The chiller's " +
    "tower is the separate water-cooling-tower entry and its pumps are separate assets; a plant " +
    "is composed in an asset group, not in one template. Authored from " +
    "docs/e5.2-derived-taglist-v1.md §4 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required, X optional, M entered by hand; alarm rows " +
    "carry a meaning and no limit, because the bands are set per site at commissioning. Five " +
    "derived points — cooling load in TR, kW/TR, COP and the two delta-Ts — are computed from " +
    "the measured rows, so the efficiency figures a chiller plant is judged on need no extra " +
    "instrument beyond the flow meter and the power meter the table already lists.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "chiller_alarm",
        pointKey: "chiller_alarm",
        severity: "critical",
        category: "operations",
        message:
          "Chiller alarm or fault active — the machine has stopped or is running restricted on " +
          "its own protection. The vendor's own code is on chiller_fault_code and on the panel; " +
          "it is carried in this text rather than enumerated, because a fault list belongs to one " +
          "OEM and a wrong enum is worse than none.",
        philosophy: {
          cause:
            "Any of the controller's own protections: low evaporator pressure or a freeze trip, " +
            "high condenser pressure, low oil pressure, a motor or starter fault, a loss of flow " +
            "on either circuit, or a sensor the controller can no longer read.",
          impact:
            "Cooling stops. On a plant with several machines the others pick the load up and the " +
            "space temperature holds; on a single-machine plant the load is unmet from the " +
            "moment of the trip, and a process chiller failure reaches the process before it " +
            "reaches anybody's comfort.",
          action:
            "Read the fault code and the controller's own alarm history before resetting — a " +
            "chiller records the readings at the moment of the trip, and a reset without a cause " +
            "is the same trip again as soon as the machine loads. Bring another machine on if " +
            "the plant has one.",
          skill: "hvac",
        },
      },
      {
        code: "chw_leaving_temp_high",
        pointKey: "chw_supply_temp_c",
        severity: "warning",
        category: "operations",
        message:
          "Chilled water leaving temperature above the setpoint the machine is holding — a " +
          "capacity shortfall. chw_setpoint_c is the setpoint this is compared against; the " +
          "permitted deviation and the time it may persist are site values.",
        philosophy: {
          cause:
            "A load beyond the machine's capacity at the current condenser conditions, a fouled " +
            "condenser or evaporator, a low refrigerant charge, a compressor unloading early on " +
            "a protection limit, or a chilled-water flow above design carrying the return " +
            "temperature up.",
          impact:
            "Everything downstream is served with warmer water than it was designed for, so " +
            "coils cannot meet their duty and the plant compensates with more flow and more fan " +
            "power. The space or the process is the last thing to notice and the first thing " +
            "anybody complains about.",
          action:
            "Compare the leaving temperature against the load and the condenser conditions " +
            "together — a shortfall at part load is a machine problem and a shortfall at full " +
            "load may simply be the design. Check the approaches on both vessels, which say " +
            "whether the surfaces are fouled.",
          skill: "hvac",
        },
      },
      {
        code: "chw_flow_low",
        pointKey: "chw_flow_lps",
        severity: "critical",
        category: "operations",
        message:
          "Chilled water flow low through the evaporator. The minimum flow is a site value from " +
          "the machine's own data, and the flow switch has its own hard trip beneath it.",
        philosophy: {
          cause:
            "A primary pump stopped or running slow, a valve closed or a strainer blocked, air " +
            "in the loop, a variable-primary control sequence that has closed too far, or a flow " +
            "switch that is itself failing.",
          impact:
            "**Evaporator freeze risk** — this is the one row on the entry where the machine can " +
            "be destroyed in minutes rather than degraded over months. Refrigerant continues to " +
            "boil against water that is barely moving, the tube wall reaches freezing and the " +
            "tubes split. A split evaporator is a rebuild, and the water side and the " +
            "refrigerant side are then one circuit.",
          action:
            "Let the flow switch trip the machine and do not bypass it — it exists for this " +
            "single failure. Restore flow before restarting: prove the pump, the valve line-up " +
            "and the strainer, and vent the loop. If the flow reading disagrees with the pumps " +
            "that are running, suspect the meter before the hydraulics.",
          skill: "hvac",
        },
      },
      {
        code: "cond_pressure_high",
        pointKey: "cond_pressure_bar",
        severity: "critical",
        category: "operations",
        message:
          "Condenser refrigerant pressure high — the machine is approaching its own high-pressure " +
          "cut-out. The band is set per site at commissioning, from the machine's data.",
        philosophy: {
          cause:
            "Condenser water too warm or too little of it — a tower fan stopped, a tower fill " +
            "fouled, a condenser pump slow — fouled or scaled condenser tubes, air or " +
            "non-condensables in the refrigerant circuit, or an overcharge.",
          impact:
            "The compressor works against a higher head for every ton it delivers, so kW/TR " +
            "rises immediately, and the machine trips on its high-pressure cut-out if the " +
            "pressure keeps climbing. A repeated high-pressure trip also stresses the " +
            "compressor's bearings and its motor.",
          action:
            "Look at the condenser-water side first — the tower, the pump and cw_delta_t_c, " +
            "which widens when flow is short — then at cond_approach_c, which says whether the " +
            "tubes are fouled. Purge and non-condensable checks come after the water side is " +
            "proved.",
          skill: "hvac",
        },
      },
      {
        code: "evap_pressure_low",
        pointKey: "evap_pressure_bar",
        severity: "critical",
        category: "operations",
        message:
          "Evaporator refrigerant pressure low — the machine is approaching its low-pressure or " +
          "freeze protection. The band is set per site at commissioning.",
        philosophy: {
          cause:
            "A refrigerant loss through a leak, chilled-water flow below the minimum, a fouled " +
            "evaporator, an expansion device or economiser fault, or simply a load far below the " +
            "machine's minimum step.",
          impact:
            "Freeze risk on the evaporator, the same failure chw_flow_low describes, reached " +
            "from the refrigerant side instead of the water side. A refrigerant loss also means " +
            "the charge is somewhere it should not be, which is an environmental and a " +
            "regulatory matter as well as a mechanical one.",
          action:
            "Check chilled-water flow first, because it is the cause that can be fixed in " +
            "minutes. Then leak-test: a machine losing charge shows a falling suction pressure " +
            "and a rising superheat together, and refrigerant_charge_pct on this template is " +
            "where the service record goes.",
          skill: "hvac",
        },
      },
      {
        code: "cond_approach_high",
        pointKey: "cond_approach_c",
        severity: "warning",
        category: "energy",
        message:
          "Condenser approach widening — the gap between the condensing refrigerant and the " +
          "leaving condenser water is growing at a comparable load. The approach this is judged " +
          "against is the commissioning value for this machine, a site value. This row is filed " +
          "as an energy concern, and the philosophy says why.",
        philosophy: {
          cause:
            "Condenser tube fouling — scale, biofilm or silt from an open cooling tower — is the " +
            "usual one, and it is what the controller-reported approach measures directly. Air " +
            "or non-condensables in the circuit, and a low condenser water flow, widen it too.",
          impact:
            "A widening approach is a machine that still makes its chilled water and spends more " +
            "doing it, every hour it runs, which is why this is an energy row and not an " +
            "operations one. Carried far enough it becomes the cond_pressure_high trip; carried " +
            "quietly it is simply a plant that costs more each year and nobody knows when it " +
            "started.",
          action:
            "Compare the approach at similar load and condenser-water conditions rather than " +
            "against a single reading, and raise the condenser tube clean — the condition_based " +
            "plan on this template exists for exactly this trigger. Check the tower's water " +
            "treatment at the same time, because the fouling came from there.",
          skill: "hvac",
        },
      },
      {
        code: "kw_per_tr_high",
        pointKey: "kw_per_tr",
        severity: "warning",
        category: "energy",
        message:
          "Specific power above the machine's commissioning baseline at a comparable load — " +
          "efficiency degradation. This alarm binds the DERIVED point kw_per_tr, computed from " +
          "the chilled-water flow and temperatures and the input power; the baseline it is " +
          "compared against is a site value recorded at commissioning.",
        philosophy: {
          cause:
            "Everything the rows above describe, summed into one number: condenser or evaporator " +
            "fouling, a low charge, non-condensables, a condenser-water or chilled-water flow " +
            "away from design, an unloading compressor held at a limit, or simply a machine " +
            "running far off the load it is efficient at.",
          impact:
            "The chiller is usually the largest single electrical load on a site, so a small " +
            "drift here is a large number over a year — and it is invisible: the machine meets " +
            "its setpoint throughout, and nothing else on the plant reports anything wrong. " +
            "This is the signal that turns chiller efficiency from an annual audit into a " +
            "continuous one.",
          action:
            "Compare like with like — same load band, same condenser-water temperature — before " +
            "concluding anything, then work down the causes above in the order the other alarms " +
            "on this template point to. Confirm the sensors first: this point is COMPUTED, so a " +
            "drifted flow meter or a drifted temperature sensor moves it without anything being " +
            "wrong with the machine, and the calibration plan on this template is what rules " +
            "that out.",
          skill: "hvac",
        },
      },
      {
        code: "oil_pressure_low",
        pointKey: "oil_pressure_bar",
        severity: "critical",
        category: "operations",
        message:
          "Compressor oil pressure — the differential across the oil circuit — low. The band is " +
          "set per site at commissioning, from the machine's own data.",
        philosophy: {
          cause:
            "A low oil level, an oil pump or its drive failing, a clogged oil filter, refrigerant " +
            "diluting the oil after a flooded start or a migration during a long standstill, or " +
            "an oil heater that has failed and let the charge absorb refrigerant.",
          impact:
            "The compressor's bearings and, on a screw machine, its rotor seals depend on that " +
            "differential. Oil pressure low is a rebuild waiting to happen and the controller " +
            "trips on it for that reason; a machine restarted repeatedly through this alarm is " +
            "being destroyed one start at a time.",
          action:
            "Do not reset and restart. Check the oil level and the filter differential, prove " +
            "the oil heater has been energised for long enough before a start, and take an oil " +
            "sample — the analysis plan on this template is what says whether the charge is " +
            "diluted or degraded.",
          skill: "hvac",
        },
      },
      {
        code: "compressor_short_cycling",
        pointKey: "start_count",
        severity: "warning",
        category: "operations",
        message:
          "Compressor starts accumulating faster than the machine is rated for. The alarm binds " +
          "the cumulative counter start_count; the per-hour RATE is the rule's to evaluate, " +
          "because a rate over a window is not expressible in the calc grammar. The permitted " +
          "rate is a site value from the machine's own data.",
        philosophy: {
          cause:
            "A control dead band too narrow for the loop, a staging sequence bringing machines on " +
            "and off against each other, a chilled-water volume too small for the plant so the " +
            "loop temperature swings quickly, or a load far below the machine's minimum step.",
          impact:
            "Every start is an inrush and a period without full oil pressure, and a chiller is " +
            "rated for only so many per hour. Short cycling wears the motor, the starter and the " +
            "bearings, and it holds the machine at its least efficient operating point — while " +
            "every individual start looks entirely normal in the log.",
          action:
            "Widen the dead band or the staging differential and check the loop volume against " +
            "the machine's minimum run time before changing anything mechanical. If the load is " +
            "genuinely below the minimum step, the answer is a smaller machine or a buffer " +
            "vessel, not a faster cycle.",
          skill: "controls",
        },
      },
    ],
    maintenance: [
      {
        title: "Condenser tube clean on approach rise",
        category: "condition_based",
        generationMode: "condition",
        intervalDays: 180,
        estimatedMinutes: 480,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Brush or chemically clean the condenser tubes when cond_approach_c widens against the " +
          "machine's commissioning approach at a comparable load and condenser-water " +
          "temperature. The plan is condition_based and generated in condition mode for that " +
          "reason; its intervalDays is the calendar backstop templateMaintenancePlanSchema " +
          "requires, not the intended trigger. A widening approach is the direct measure of " +
          "fouling, and it is what turns this from a calendar clean into a clean that happens " +
          "when the machine needs one. Review the tower's water treatment in the same visit, " +
          "because the fouling arrived from there.",
      },
      {
        title: "Refrigerant charge and leak check",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 120,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Leak-test the circuit, check the charge and the sight glass, and record the result " +
          "against refrigerant_charge_pct — the entry's one M row, which carries a null " +
          "sourceDataKeyPattern forever because the value is written by hand and never mapped. " +
          "This plan is the only thing that produces that row's value. A machine losing charge " +
          "shows a falling evaporator pressure long before it shows a capacity shortfall, and a " +
          "leak is an environmental and a regulatory matter as well as a mechanical one.",
      },
      {
        title: "Compressor oil analysis and oil-filter change",
        category: "runtime_based",
        generationMode: "runtime",
        intervalDays: 365,
        estimatedMinutes: 180,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Sample the oil for acidity, moisture and wear metals and change the oil filter, on " +
          "the machine's accumulated hours rather than the calendar — run_hours_h is the " +
          "counter. The plan is runtime_based in runtime mode for that reason. Oil analysis is " +
          "the earliest warning a hermetic or semi-hermetic compressor gives: acid and wear " +
          "metals appear in the sample months before oil_pressure_low appears on the panel.",
      },
      {
        title: "Chiller sensor and flow-switch calibration",
        category: "calibration",
        generationMode: "calendar",
        intervalDays: 180,
        estimatedMinutes: 120,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Calibrate chw_supply_temp_c and chw_return_temp_c against a reference, verify " +
          "chw_flow_lps and the power meter behind cooling_kw, and function-test the evaporator " +
          "flow switch. Those four measured rows are the inputs to cooling_load_tr, kw_per_tr " +
          "and cop, which are COMPUTED points: when an input drifts, nothing looks wrong — a " +
          "flow meter reading high produces a confident kW/TR that is simply false, so the " +
          "kw_per_tr_high alarm either fires on nothing or stays quiet through a real " +
          "degradation. This plan is what keeps a computed KPI honest, and the flow switch it " +
          "also tests is the evaporator's freeze protection.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "chiller_status", label: "Run status", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "chiller_alarm", label: "Chiller alarm / fault active", unit: null, required: true, sortOrder: 1, meta: CORE },
    // Tier X here where the VFD's equivalent row is tier C — the document's own
    // split. No alarm binds it: chiller_alarm binds the 0/1 flag above and
    // carries the vendor code in its text.
    { ...MEASURED, pointKey: "chiller_fault_code", label: "Active fault code", unit: null, required: false, sortOrder: 2, meta: EXTENDED },
    // Reused ● — five of HVAC_POINT_KEYS's nine codes are on this entry, which
    // is why the pack's new HVAC codes went into a SEPARATE array: the closed
    // z.enum over the nine is what the CRAC screens consume.
    { ...MEASURED, pointKey: "chw_supply_temp_c", label: "Chilled water leaving (supply) temperature", unit: "°C", required: true, sortOrder: 3, meta: CORE },
    { ...MEASURED, pointKey: "chw_return_temp_c", label: "Chilled water entering (return) temperature", unit: "°C", required: true, sortOrder: 4, meta: CORE },
    { ...MEASURED, pointKey: "chw_setpoint_c", label: "CHW leaving temperature setpoint", unit: "°C", required: true, sortOrder: 5, meta: CORE },
    { ...MEASURED, pointKey: "chw_flow_lps", label: "Chilled water flow", unit: "L/s", required: true, sortOrder: 6, meta: CORE },
    { ...MEASURED, pointKey: "cw_entering_temp_c", label: "Condenser water entering temperature", unit: "°C", required: true, sortOrder: 7, meta: CORE },
    { ...MEASURED, pointKey: "cw_leaving_temp_c", label: "Condenser water leaving temperature", unit: "°C", required: true, sortOrder: 8, meta: CORE },
    // The four CW rows (with cw_delta_t_c) are what an air-cooled machine
    // strikes from its imported draft — a redline, not a second entry.
    { ...MEASURED, pointKey: "cw_flow_lps", label: "Condenser water flow", unit: "L/s", required: false, sortOrder: 9, meta: EXTENDED },
    { ...MEASURED, pointKey: "evap_pressure_bar", label: "Evaporator refrigerant pressure", unit: "bar", required: false, sortOrder: 10, meta: EXTENDED },
    { ...MEASURED, pointKey: "cond_pressure_bar", label: "Condenser refrigerant pressure", unit: "bar", required: false, sortOrder: 11, meta: EXTENDED },
    { ...MEASURED, pointKey: "evap_approach_c", label: "Evaporator approach", unit: "°C", required: false, sortOrder: 12, meta: EXTENDED },
    // CONTROLLER-REPORTED, and not E5.1's tower approach_c, which is computed
    // there from a wet-bulb input. Two quantities, two assets, two codes.
    { ...MEASURED, pointKey: "cond_approach_c", label: "Condenser approach", unit: "°C", required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "compressor_ok", label: "Compressor healthy", unit: null, required: true, sortOrder: 14, meta: CORE },
    { ...MEASURED, pointKey: "compressor_load_pct", label: "Compressor load / IGV / slide valve", unit: "%", required: true, sortOrder: 15, meta: CORE },
    { ...MEASURED, pointKey: "compressor_current_a", label: "Compressor motor current", unit: "A", required: true, sortOrder: 16, meta: CORE },
    // The kW half of kw_per_tr and cop — tier C, so both compute everywhere.
    { ...MEASURED, pointKey: "cooling_kw", label: "Chiller input power", unit: "kW", required: true, sortOrder: 17, meta: CORE },
    { ...MEASURED, pointKey: "kwh_total", label: "Cumulative energy", unit: "kWh", required: false, sortOrder: 18, meta: EXTENDED },
    // Reused ● — the DG set's lubrication-oil pair, the same two the compressor
    // reuses, with the same meaning on a refrigeration compressor.
    { ...MEASURED, pointKey: "oil_pressure_bar", label: "Compressor oil pressure (differential)", unit: "bar", required: false, sortOrder: 19, meta: EXTENDED },
    { ...MEASURED, pointKey: "oil_temp_c", label: "Oil sump temperature", unit: "°C", required: false, sortOrder: 20, meta: EXTENDED },
    { ...MEASURED, pointKey: "discharge_temp_c", label: "Compressor discharge temperature", unit: "°C", required: false, sortOrder: 21, meta: EXTENDED },
    { ...MEASURED, pointKey: "run_hours_h", label: "Run hours", unit: "h", required: true, sortOrder: 22, meta: CORE },
    // The counter compressor_short_cycling binds — a per-hour rate is not
    // expressible, so the rate is the rule's to evaluate over this row.
    { ...MEASURED, pointKey: "start_count", label: "Compressor starts", unit: null, required: false, sortOrder: 23, meta: EXTENDED },
    // The one M row — a charge level read with the machine down and written on a
    // sheet. Null pattern forever, so always in skippedPoints.
    { ...MEASURED, pointKey: "refrigerant_charge_pct", label: "Charge level", unit: "%", required: false, sortOrder: 24, meta: MANUAL },
    // Derived, appended after the table rows in the order §4's own Derived: line
    // names them. No meta.tier: the C/X/M column says what the plant has FITTED,
    // and a computed point is fitted by nobody. 4.19 kJ/kg·K and 3.517 kW/TR are
    // the DOCUMENT's constants — physics, not site values.
    {
      ...derived(
        "{chw_flow_lps} * ({chw_return_temp_c} - {chw_supply_temp_c}) * 4.19 / 3.517",
      ),
      pointKey: "cooling_load_tr",
      label: "Cooling load",
      unit: "TR",
      required: false,
      sortOrder: 25,
    },
    // The ΔT is RESTATED and not referenced: a derived point may reference only
    // MEASURED points of the same entry (ADR 0036 decision 7), so the reference
    // form does not parse. Required, not clumsy — do not "simplify" it.
    {
      ...derived(
        "{cooling_kw} * 3.517 / ({chw_flow_lps} * ({chw_return_temp_c} - {chw_supply_temp_c}) * 4.19)",
      ),
      pointKey: "kw_per_tr",
      label: "Specific power (kW/TR)",
      unit: "kW/TR",
      required: false,
      sortOrder: 26,
    },
    // Dimensionless — the catalogue spells the unit "" and the template null.
    // The same information as kW/TR the other way up, as §4 writes it.
    {
      ...derived(
        "{chw_flow_lps} * ({chw_return_temp_c} - {chw_supply_temp_c}) * 4.19 / {cooling_kw}",
      ),
      pointKey: "cop",
      label: "Coefficient of performance",
      unit: null,
      required: false,
      sortOrder: 27,
    },
    {
      ...derived("{chw_return_temp_c} - {chw_supply_temp_c}"),
      pointKey: "chw_delta_t_c",
      label: "Chilled water ΔT",
      unit: "°C",
      required: false,
      sortOrder: 28,
    },
    {
      ...derived("{cw_leaving_temp_c} - {cw_entering_temp_c}"),
      pointKey: "cw_delta_t_c",
      label: "Condenser water ΔT",
      unit: "°C",
      required: false,
      sortOrder: 29,
    },
  ],
};
