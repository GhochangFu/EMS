import { CORE, derived, EXTENDED, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The mechanical pack's air-handling-unit class — `E5.2`, ADR 0053 decisions
 * 1-11, ADR 0052 decisions 1, 2 and 6, ADR 0019 Amendment 2.
 *
 * **THE SECOND STOCK ENTRY FILED UNDER `hvac`**, after the chiller, and for the
 * same reason: ADR 0053 decision 2 files an entry under the domain its keys
 * already live in, and five of §6's rows are `HVAC_POINT_KEYS` codes. The module
 * lives under `mechanical.ts` all the same — `PACK_SOURCE_DOC` is keyed by code
 * PREFIX and a pack is one DOCUMENT, and the two are different axes.
 *
 * **SOURCE.** `docs/e5.2-derived-taglist-v1.md` §6 — *"AHU — air handling unit
 * (CHW coil, VAV or CAV)"*. PROVISIONAL: derived from published practice, not
 * client-confirmed. §6 lists **ASHRAE Guideline 36's required AFDD points
 * first** — supply, return, mixed and outdoor air temperatures, duct static, the
 * two setpoints, the coil valve and the fan speed — *"then the usual extras"*.
 * That is why the row order below looks like an instrument list rather than a
 * panel layout, and why the two setpoints are declared as MEASURED points: G36's
 * fault-detection routines compare a reading against the setpoint the controller
 * is holding, so the setpoint has to arrive as a point like any other. No `_sp`
 * convention existed in this vocabulary before this pack; §6 spells it with an
 * `_sp_` infix and the entry follows the document.
 *
 * **28 POINTS — 13 core + 13 extended + 0 manual + 2 DERIVED.** §6's 26 table
 * rows in the document's own order (`sortOrder` 0-25), then the two authored
 * derived codes (26-27). **No `M` row at all**, the first entry in the pack with
 * none since the VFD: everything §6 lists is read by the unit's own controller.
 *
 * **NINE OF THE TWENTY-SIX ROWS ARE REUSED CODES — REFERENCED AND NEVER
 * REDECLARED** (ADR 0053 decision 3):
 *
 *  - `supply_air_temp_c`, `return_air_temp_c`, `fan_speed_pct`, `fan_rpm`,
 *    `fan_current_a` — five of `HVAC_POINT_KEYS`'s nine codes, which the seeded
 *    `BASELINE-HVAC` template, `rule-points.ts`, `control-room-bindings.ts` and
 *    the CRAC screens all consume today. **This is why the pack's new HVAC codes
 *    went into a SEPARATE array** (`HVAC_CLASS_POINT_KEYS`): `hvacPointKeySchema`
 *    is a closed `z.enum(HVAC_POINT_KEYS)`, and widening the nine would have
 *    reached every one of those consumers for no benefit here.
 *  - `chw_supply_temp_c`, `chw_return_temp_c` — **the same two codes the chiller
 *    names, and the same meaning at a different place**: chilled water leaving
 *    and entering the machine there, entering and leaving the coil here. One
 *    meaning, one code (ADR 0051 Amendment 6 decision 5), so no `coil_chw_*`
 *    pair is minted. What differs is the TIER — tier C on the chiller, which
 *    cannot run without them, and tier X here, because most air handlers carry no
 *    coil-water thermometry at all.
 *  - `kw`, `run_hours_h` — the counters the pump and the compressor already name.
 *
 * **`fan_rpm`'S TEMPLATE UNIT IS `RPM`, NOT §6's `rpm`.** A template `unit` is an
 * OVERRIDE of the catalogue's, and the catalogue has spelled this one `RPM` since
 * the platform's first HVAC keys. Overriding a catalogue unit with a different
 * spelling of the same unit would ship two spellings to every organization that
 * imports the entry — and `seedPointKeyCatalog` inserts with `COALESCE`, so the
 * catalogue value could not be corrected afterwards either. The entry spec's
 * `[pointKey, tier, unit]` table is the only check in the repository that reads a
 * template unit at all, and it asserts `RPM`.
 *
 * **§6 CARRIES NO FAN RUN STATUS, AND THAT IS THIS ENTRY'S RECORDED v2 REDLINE
 * CANDIDATE.** `E5.1` §4.2 flagged `fan_status` as the global code an AHU should
 * reuse. The E5.2 tag list does not carry it: §6 declares `ahu_status` (the
 * UNIT's run status) and no fan status, while its own alarm bullet is *"fan
 * running with no status (belt / VFD)"*. The entry therefore binds
 * `fan_current_a` — no motor current with the fan commanded is a broken belt, a
 * slipping coupling or a drive that is not running — and **declares no
 * `fan_status` row**, because putting a row in a shipped entry that the cited
 * source does not contain is the one thing a PROVISIONAL transcription may not
 * do. This is the `dosing_tank_level_pct` shape from `E5.1`: the gap is recorded
 * here and in the alarm's own message, the workshop handout is where the client
 * adds the row, and the day it lands the binding moves in a `stockVersion` 2.
 *
 * **THE TWO FORMULAS** (plan §5.0), promoted into the vocabulary because a
 * derived point's `pointKey` passes `assertPointKeysActive` like any other:
 *
 *  - `sat_deviation_c` = `{supply_air_temp_c} - {supply_air_temp_sp_c}` — **the
 *    G36 AFDD quantity this entry exists to make reviewable**. Both inputs are
 *    tier C, so it computes on every unit the template is imported onto. It is
 *    **signed on purpose**: the order of the two terms is the difference between
 *    air the coil is not holding down and a unit that is overcooling, and those
 *    are two faults with opposite remedies. Do not reverse it to "make the alarm
 *    positive" — the alarm's band is the site's.
 *  - `coil_delta_t_c` = `{chw_return_temp_c} - {chw_supply_temp_c}` — the ΔT
 *    across the cooling coil. **Both inputs are tier X**, which is legal: the
 *    reference check requires a key to be DECLARED and not required (ADR 0036
 *    decision 7), so a unit with no coil-water thermometry simply gets no value.
 *    Promoting the inputs to C to "fix" that would make a required point with a
 *    null pattern, which is a 400 at instantiation on every site that never
 *    fitted them.
 *
 * **`coil_delta_t_c` AND THE CHILLER'S `chw_delta_t_c` ARE TWO CODES WITH ONE
 * FORMULA STRING.** The same arithmetic over the same two vocabulary codes, read
 * at two places in the same water circuit: the plant loop ΔT at the machine, and
 * the ΔT across one coil. A plant running a low loop ΔT while a particular coil
 * does its job is a real and diagnosable state, and one merged code could not
 * express it. Plan §12 question 4 asked whether to merge them and **the owner
 * ruled to keep both** (2026-09-03) — the tag list is the handout a client
 * redlines, a merge is a one-line redline the client can make, and a plan-side
 * merge would silently edit the handout before anybody read it. The entry spec
 * asserts the pair from this side, so a later "tidy" has to read the reason.
 *
 * **DIVISION BY ZERO CANNOT ARISE HERE AND NOTHING IS GUARDED ANYWAY.** Both
 * formulas are subtractions, so neither has a denominator; `evaluate.ts` still
 * returns `non_finite` for any non-finite intermediate, which is the correct
 * answer everywhere in this pack. **Neither overrides `maxInputAgeSeconds`**: the
 * air temperatures, the setpoint and the two water temperatures all arrive from
 * the unit's own controller at one scan rate, inside the 300 s default. The entry
 * spec asserts `null` on both, so a "helpful" override is a test failure with a
 * reason.
 *
 * **THREE DERIVED CODES ARE DEFERRED AND NAMED, never placeholdered** (ADR 0053
 * decision 6; ADR 0051 Amendment 6 decision 8). `stock-catalog-deferrals.spec.ts`
 * holds the list and asserts this entry declares none of them:
 *
 *  - **An asset attribute** — `filter_life_pct`. A percentage of filter life
 *    needs the clean and the dirty pressure-drop band, which is per filter class
 *    and per manufacturer, and an attribute table is not a point. The measurement
 *    is `filter_dp_pa`, the alarm on it is `filter_dp_high`, and the
 *    condition_based plan below is what the percentage would have been for.
 *  - **A time window** — `fan_energy_kwh_day`. Kilowatt-hours per day is a
 *    window and `bms-calc-v1` has no state.
 *  - **A meter the section does not list** — `cooling_delivered_kw`. The coil's
 *    duty is flow × ΔT, and §6 declares the two chilled-water temperatures and
 *    **no flow at the coil**. This is the honest half of the ΔT above: the AHU
 *    can say how hard the coil is working per litre and cannot say how many
 *    litres. A CHW flow meter per AHU is a v2 redline the client can price.
 *
 * **NO `content.kpis`** (ADR 0053 decision 6, the same structural reason the pack
 * index records): every ratio §6 names and the grammar can express is a named
 * derived code, so it is a POINT — and a point can carry an alarm, which is
 * exactly what `sat_deviation_high` does. A KPI could not be bound at all.
 *
 * **ALARMS — 8, one per §6 bullet.** Every row is **pair-absent** — no
 * `thresholdValue`, no `operator` (ADR 0019 Amendment 2, and B7: limit values are
 * set per site at commissioning) — and every row carries a populated ADR 0019 §3
 * `philosophy`, which ADR 0053 decision 5 requires of this pack.
 *
 * **THREE ROWS ARE `comfort`, AND THIS IS THE FIRST STOCK ENTRY ANYWHERE TO USE
 * THAT CATEGORY** (plan §12 ruling 6). Migration `0029` has seeded `comfort`
 * beside `energy`, `safety` and `operations` since the beginning and no catalog
 * entry had ever authored one: `sat_deviation_high`, `return_rh_high` and
 * `co2_high` are all about what the occupants of a space are given — air off
 * setpoint, humidity the coil is not removing, ventilation air that is short —
 * and an AHU serves those occupants directly. The chiller's equivalent row is
 * deliberately `operations`, because a chiller serves a loop whose load is
 * unknown to it. `fire_trip` is `safety`; the other four are `operations`.
 *
 * **`philosophy.skill` IS `hvac` ON SEVEN OF THE EIGHT.** An air handler, its
 * coil, its dampers, its filters and its fire interlock are all the HVAC trade's.
 * The exception is `supply_fan_not_running`, which is **`mechanical`**: a fan
 * commanded with no motor current is a belt, a coupling or a drive, which is the
 * mechanical trade's work on a machine the HVAC trade owns. **`fire_trip` is
 * `hvac` by plan §12 ruling 7** — the fire system, not a trade, answers the
 * event, and the AHU is restarted by the HVAC trade after the all-clear; its
 * action text says not to restart until the fire system resets. The alternative
 * was no skill at all, which would have widened the pack's "no seeded trade
 * answers this" class from process chemistry to a life-safety row. **This entry
 * has no process-chemistry row**: all four of the pack's no-skill rows are the
 * boiler's, and the entry spec passes an empty list, which is a claim rather than
 * a gap.
 *
 * **MAINTENANCE — 4 plans, PROVISIONAL** (plan §12 ruling 5), derived from G36
 * and AHU-OEM practice, because the tag list has no maintenance section. **One is
 * `safetyCritical`** — the fire-trip interlock test, the second of exactly three
 * ADR 0053 decision 8 names for this pack. An air handler that keeps running
 * through a fire signal moves smoke through a building, and the interlock is the
 * barrier that stops it. The first plan is `condition_based` in `condition` mode
 * and names `filter_dp_pa`, the point whose rise is its trigger; its
 * `intervalDays` is the calendar backstop `templateMaintenancePlanSchema`
 * requires, not the intended trigger.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the site's
 * telemetry wiring, which the tag list does not know and the catalog must not
 * guess, so an imported draft cannot be instantiated until an operator fills the
 * patterns in.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `hvac-ahu` **v1** (2026-09-03, `E5.2`): authored from
 *    `e5.2-derived-taglist-v1.md` §6, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const HVAC_AHU: StockAssetTemplateEntry = {
  code: "hvac-ahu",
  name: "Air handling unit (CHW coil)",
  assetType: "ahu",
  domain: "hvac",
  description:
    "Air handling unit with a chilled-water cooling coil, VAV or CAV — Guideline 36's required " +
    "fault-detection points first (the supply, return, mixed and outdoor air temperatures, the " +
    "duct static and the two setpoints the controller holds, the coil valve and the fan speed), " +
    "then the dampers, the filter, the humidity and CO2 rows and the unit's energy and hour " +
    "counters. The two setpoints are declared as measured points because the fault-detection " +
    "routines compare a reading against what the controller is holding. Authored from " +
    "docs/e5.2-derived-taglist-v1.md §6 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required and X optional; alarm rows carry a meaning and " +
    "no limit, because the bands are set per site at commissioning. Two derived points — the " +
    "supply-air deviation from setpoint and the coil chilled-water delta-T — are computed from " +
    "the measured rows. The section carries no fan run status, so the fan alarm binds the fan " +
    "motor current and the missing row is a redline for the client's review.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "ahu_fault",
        pointKey: "ahu_fault",
        severity: "critical",
        category: "operations",
        message:
          "Air handling unit fault or trip — the unit has stopped or is running on its own " +
          "protection. The controller's own fault text is on the panel; it is carried in this " +
          "text rather than enumerated, because a fault list belongs to one OEM.",
        philosophy: {
          cause:
            "A supply or return fan overload or drive fault, a smoke or freeze stat, a filter " +
            "switch wired as a trip, a damper end-switch that has not made, a loss of control " +
            "power, or a controller that has lost a sensor it needs to run.",
          impact:
            "The space this unit serves stops being conditioned and stops being ventilated. On a " +
            "process floor or a laboratory that reaches the process quickly; in an office it is " +
            "noticed as the space drifts, which is slower and just as real. A stopped AHU also " +
            "stops the outdoor air the building's pressure balance depends on.",
          action:
            "Read the controller's own fault before resetting, and check the fire and freeze " +
            "interlocks first — a reset through a safety interlock is a unit that will trip again " +
            "and a barrier that has been overridden. Prove the fan, the dampers and the sensors, " +
            "then restart and watch the supply air temperature settle.",
          skill: "hvac",
        },
      },
      {
        code: "sat_deviation_high",
        pointKey: "sat_deviation_c",
        severity: "warning",
        category: "comfort",
        message:
          "Supply air temperature away from its setpoint — the unit is not holding the air it is " +
          "asked for. This alarm binds the DERIVED point sat_deviation_c, computed as the supply " +
          "air temperature minus supply_air_temp_sp_c; the permitted deviation and the time it " +
          "may persist are site values set at commissioning.",
        philosophy: {
          cause:
            "A chilled-water supply that is warmer than design or short of flow, a coil valve " +
            "that is stuck, hunting or has lost its actuator, a fouled or air-bound coil, an " +
            "outdoor-air damper open beyond its economiser sequence, or a load the unit was never " +
            "sized for. A stuck valve and a warm loop look identical on this point alone, which " +
            "is why the coil delta-T beside it is worth reading.",
          impact:
            "The space is served with air that is not what its terminals were balanced for, so " +
            "zones fight each other, terminal boxes drive to their limits and the occupants feel " +
            "it. On a process area the setpoint is a specification rather than a preference. " +
            "Downstream, a plant compensating with more flow and more fan power spends money for " +
            "conditioning it is not delivering.",
          action:
            "Read the deviation with the coil valve position and coil_delta_t_c together: a valve " +
            "at full travel with a narrow delta-T is a water-side problem, and a wide delta-T " +
            "with the valve barely open is a control problem. Confirm the setpoint the controller " +
            "is holding is the one it should be holding — a schedule or a reset sequence changes " +
            "it, and an alarm against the wrong target is not a fault at all.",
          skill: "hvac",
        },
      },
      {
        code: "duct_static_low",
        pointKey: "duct_static_pa",
        severity: "warning",
        category: "operations",
        message:
          "Supply duct static pressure below the setpoint with the fan at or near maximum speed. " +
          "duct_static_sp_pa is the setpoint this is read against; the band and the dwell are " +
          "site values.",
        philosophy: {
          cause:
            "A blocked or loaded filter, a damper that has closed or failed shut, a broken or " +
            "slipping fan belt, a drive limited by its own protection, a duct or a fire damper " +
            "that has dropped, or a static sensor whose tubing has come off — which reads low " +
            "with nothing wrong at all.",
          impact:
            "Terminal boxes downstream cannot get the air they are asking for, so the zones " +
            "furthest from the unit are starved first and the complaint arrives from one end of " +
            "a floor. A fan held at maximum against a restriction also runs at its least " +
            "efficient point and wears its belts and bearings faster.",
          action:
            "Check the filter differential and the damper positions before touching the fan, then " +
            "the belt and the drive. If the fan is at maximum and the filter is clean and the " +
            "dampers are open, suspect the sensor's tubing before the ductwork.",
          skill: "hvac",
        },
      },
      {
        code: "filter_dp_high",
        pointKey: "filter_dp_pa",
        severity: "warning",
        category: "operations",
        message:
          "Filter differential pressure high — the filter is loaded and a change is due. The " +
          "clean and dirty pressure drops are per filter class and per manufacturer, so the band " +
          "is a site value; filter_life_pct is deferred for the same reason.",
        philosophy: {
          cause:
            "Normal loading over the filter's service life, an outdoor air path that is dirtier " +
            "than the design assumed (construction, a dry season, a nearby process), a pre-filter " +
            "left out at the last change, or a filter installed with a gap that has since packed.",
          impact:
            "A loaded filter costs fan power for every hour it stays in, and past a point the fan " +
            "cannot make the duct static at all, which is what duct_static_low reports. Loaded far " +
            "enough, media collapses or blows through and the coil behind it fouls — a much more " +
            "expensive clean than the filter it replaced.",
          action:
            "Change the filter and record it against the plan on this template. Change the " +
            "pre-filter with it if the unit has one, and look at the coil while the filter is out: " +
            "if the media has been through, the fouling is already downstream.",
          skill: "hvac",
        },
      },
      {
        code: "return_rh_high",
        pointKey: "return_air_rh_pct",
        severity: "warning",
        category: "comfort",
        message:
          "Return air relative humidity high — the coil is not removing moisture, or the moisture " +
          "it removes is not draining away. The band is a site value and depends on what the " +
          "space is for.",
        philosophy: {
          cause:
            "A supply air temperature held too high to dehumidify (a reset sequence tuned only " +
            "for temperature does this), a chilled-water supply warmer than design, an " +
            "outdoor-air damper admitting more humid air than the coil can handle, a condensate " +
            "trap that has dried out or blocked so the pan re-evaporates what the coil removed, " +
            "or simply a wet season the sequence was not tuned for.",
          impact:
            "Occupants feel humidity long before they can name it, and the usual response is to " +
            "drop the temperature setpoint, which costs energy and does not fix the moisture. " +
            "Sustained high humidity grows mould in the ductwork and on the surfaces the air " +
            "reaches, and in a store or a laboratory it damages what is kept there.",
          action:
            "Check the condensate path first, because a dry or blocked trap is common and cheap " +
            "to fix and puts the moisture straight back into the air. Then read the supply air " +
            "temperature and the coil delta-T: a coil that is not getting cold enough cannot " +
            "dehumidify, whatever the humidity setpoint says.",
          skill: "hvac",
        },
      },
      {
        code: "co2_high",
        pointKey: "return_air_co2_ppm",
        severity: "warning",
        category: "comfort",
        message:
          "Return air carbon dioxide above the ventilation target — the outdoor air the space is " +
          "getting is short of what its occupancy needs. The target is a site value from the " +
          "ventilation standard the building is designed to.",
        philosophy: {
          cause:
            "An outdoor-air damper closed, stuck or minimum-position-set below what the space " +
            "needs; a demand-controlled ventilation sequence reading a drifted sensor; an " +
            "occupancy above what the unit was sized for; or a supply air volume reduced by a " +
            "loaded filter or a fan at a limit, which reduces the outdoor air with it.",
          impact:
            "Carbon dioxide is the measurable proxy for ventilation, and ventilation is what " +
            "removes everything else the occupants and the space produce. Occupants report " +
            "stuffiness, headaches and drowsiness; concentration and productivity measurably " +
            "fall. In a room with a process, the same shortfall applies to whatever the process " +
            "gives off.",
          action:
            "Read the outdoor-air damper position and the supply air volume together with this " +
            "point — the ventilation shortfall is almost always one of those two. Calibrate the " +
            "sensor if the reading disagrees with the occupancy: a drifted carbon-dioxide sensor " +
            "either starves a full room or over-ventilates an empty one, and both are expensive.",
          skill: "hvac",
        },
      },
      {
        code: "fire_trip",
        pointKey: "fire_trip_state",
        severity: "critical",
        category: "safety",
        message:
          "Fire or smoke interlock tripped — the unit has been stopped by the building's fire " +
          "system. Do not restart it until the fire system has reset and the all-clear has been " +
          "given.",
        philosophy: {
          cause:
            "A fire alarm or a smoke detector in the unit, the supply duct or the return duct; a " +
            "duct smoke detector that has been triggered by dust or by works in the ceiling void; " +
            "a fire panel test; or a fault in the interlock wiring, which fails to the safe side " +
            "and stops the unit.",
          impact:
            "An air handler running through a fire event moves smoke through a building faster " +
            "than anything else in it, which is why this interlock exists and why it is hard-wired " +
            "rather than left to the controller. The unit stopping is the correct outcome; the " +
            "space losing conditioning and ventilation is the accepted cost of it.",
          action:
            "Do not restart, and do not defeat or bypass the interlock to keep a space " +
            "comfortable. The fire system owns this event: the unit goes back into service after " +
            "the fire system resets and the responsible person gives the all-clear, and the HVAC " +
            "trade then proves the fan, the dampers and the smoke detector before it runs. If the " +
            "trip was spurious, the detector and its environment are the investigation, not the " +
            "interlock.",
          skill: "hvac",
        },
      },
      {
        code: "supply_fan_not_running",
        pointKey: "fan_current_a",
        severity: "warning",
        category: "operations",
        message:
          "Supply fan commanded to run with no motor current — the fan is not turning. This row " +
          "binds the fan motor current BECAUSE THE SECTION CARRIES NO FAN RUN STATUS: ahu_status " +
          "is the unit's status and not the fan's, so the platform infers the fan from its " +
          "current. A fan run status is a redline candidate for the client's review, and the " +
          "binding moves to it if the row is added.",
        philosophy: {
          cause:
            "A broken or thrown belt on a belt-driven fan, a slipping or failed coupling, a drive " +
            "that has faulted or is in a local or stopped mode while the controller thinks it is " +
            "running, a motor overload that has tripped, or a current transducer that has failed " +
            "low — which reads exactly the same and means nothing is wrong.",
          impact:
            "No air is delivered while every other reading on the unit looks plausible: the " +
            "controller commands a speed, the valve modulates, the setpoint is held nowhere. This " +
            "is the failure that goes unnoticed longest on an air handler, because a unit that " +
            "reports itself as running does not send anybody to look at it.",
          action:
            "Attend the unit and look at the fan rather than at the panel — the shaft is either " +
            "turning or it is not. Prove the belt or coupling, the drive's own status, and the " +
            "motor overload, and check the current transducer against a clamp meter before " +
            "concluding the fan is stopped when it is running.",
          skill: "mechanical",
        },
      },
    ],
    maintenance: [
      {
        title: "Filter change on differential pressure",
        category: "condition_based",
        generationMode: "condition",
        intervalDays: 90,
        estimatedMinutes: 60,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Change the supply-air filters when filter_dp_pa reaches the dirty pressure drop for " +
          "the filter class fitted, and change any pre-filter with them. The plan is " +
          "condition_based and generated in condition mode for that reason; its intervalDays is " +
          "the calendar backstop templateMaintenancePlanSchema requires, not the intended " +
          "trigger. A filter is changed when it is loaded and not when the calendar says so — " +
          "which is also why filter_life_pct is deferred: the clean and dirty band is per filter " +
          "class and per manufacturer, so it is an attribute table rather than a formula. Inspect " +
          "the coil face while the filters are out; media that has blown through has already " +
          "fouled what is behind it.",
      },
      {
        title: "Cooling coil clean and condensate drain flush",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 180,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Clean the coil face and fins, flush the condensate pan and drain, and prove the trap " +
          "holds a seal. A fouled coil widens coil_delta_t_c for the duty it delivers and shows " +
          "as a supply-air deviation the water side cannot explain; a dry or blocked trap puts " +
          "the moisture the coil removed straight back into the supply air, which is the first " +
          "thing to check behind return_rh_high. Do this before the cooling season rather than " +
          "during it.",
      },
      {
        title: "Supply fan belt, bearing and motor service",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 120,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Check and tension or replace the fan belts, grease or inspect the fan bearings, check " +
          "the motor and drive alignment, and read fan_current_a against the unit's nameplate " +
          "with the fan at speed. This is the plan behind supply_fan_not_running: a thrown belt " +
          "is the usual cause, and it is the one this visit prevents. Record the current at a " +
          "known speed each visit — a fan whose current is drifting at the same command is a " +
          "bearing on its way out.",
      },
      {
        title: "Fire-trip interlock test",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 45,
        priority: "critical",
        safetyCritical: true,
        triggerSummary:
          "Function-test the fire and smoke interlock with the building's fire system: simulate " +
          "the signal, prove the unit stops, prove fire_trip_state reports it, and prove the " +
          "smoke dampers drive to their fire position. An air handler that keeps running through " +
          "a fire signal moves smoke through a building faster than anything else in it, which is " +
          "why the interlock is hard-wired rather than left to the controller — and why this is " +
          "the entry's one safetyCritical plan (ADR 0053 decision 8). Test it with the fire " +
          "system's own people and record the result against the building's fire log, not only " +
          "against this asset. A defeated or bypassed interlock found during the test is an " +
          "immediate finding, not a work order for later.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "ahu_status", label: "Unit run status", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "ahu_fault", label: "Unit fault / trip", unit: null, required: true, sortOrder: 1, meta: CORE },
    // Reused ● — five of HVAC_POINT_KEYS's nine codes are on this entry, which
    // is why the pack's new HVAC codes went into a SEPARATE array: the closed
    // z.enum over the nine is what the CRAC screens consume.
    { ...MEASURED, pointKey: "supply_air_temp_c", label: "Supply air temperature", unit: "°C", required: true, sortOrder: 2, meta: CORE },
    // A SETPOINT declared as a measured point: G36's fault-detection routines
    // compare a reading against what the controller is holding, so the setpoint
    // has to arrive as a point. The _sp_ infix is §6's own spelling.
    { ...MEASURED, pointKey: "supply_air_temp_sp_c", label: "Supply air temperature setpoint", unit: "°C", required: true, sortOrder: 3, meta: CORE },
    { ...MEASURED, pointKey: "return_air_temp_c", label: "Return air temperature", unit: "°C", required: true, sortOrder: 4, meta: CORE },
    { ...MEASURED, pointKey: "mixed_air_temp_c", label: "Mixed air temperature", unit: "°C", required: false, sortOrder: 5, meta: EXTENDED },
    { ...MEASURED, pointKey: "outdoor_air_temp_c", label: "Outdoor air temperature", unit: "°C", required: false, sortOrder: 6, meta: EXTENDED },
    { ...MEASURED, pointKey: "return_air_rh_pct", label: "Return air relative humidity", unit: "%", required: true, sortOrder: 7, meta: CORE },
    { ...MEASURED, pointKey: "supply_air_rh_pct", label: "Supply air relative humidity", unit: "%", required: false, sortOrder: 8, meta: EXTENDED },
    { ...MEASURED, pointKey: "duct_static_pa", label: "Supply duct static pressure", unit: "Pa", required: true, sortOrder: 9, meta: CORE },
    { ...MEASURED, pointKey: "duct_static_sp_pa", label: "Duct static pressure setpoint", unit: "Pa", required: true, sortOrder: 10, meta: CORE },
    { ...MEASURED, pointKey: "fan_speed_pct", label: "Supply fan speed command", unit: "%", required: true, sortOrder: 11, meta: CORE },
    // RPM, the catalogue's spelling, NOT §6's "rpm". A template unit is an
    // override, and two spellings of one unit would ship to every importer and
    // could not be corrected by a later seed (COALESCE).
    { ...MEASURED, pointKey: "fan_rpm", label: "Supply fan speed", unit: "RPM", required: false, sortOrder: 12, meta: EXTENDED },
    // What supply_fan_not_running binds, because §6 declares no fan run status
    // at all — the entry's recorded v2 redline candidate.
    { ...MEASURED, pointKey: "fan_current_a", label: "Supply fan motor current", unit: "A", required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "return_fan_speed_pct", label: "Return / exhaust fan speed", unit: "%", required: false, sortOrder: 14, meta: EXTENDED },
    { ...MEASURED, pointKey: "chw_valve_pct", label: "Cooling coil valve position", unit: "%", required: true, sortOrder: 15, meta: CORE },
    // Reused ● — the chiller's two codes, the same meaning at a different place
    // in the same circuit, at a different TIER: C on a machine that cannot run
    // without them, X here because most air handlers carry no coil thermometry.
    { ...MEASURED, pointKey: "chw_supply_temp_c", label: "Coil entering CHW temperature", unit: "°C", required: false, sortOrder: 16, meta: EXTENDED },
    { ...MEASURED, pointKey: "chw_return_temp_c", label: "Coil leaving CHW temperature", unit: "°C", required: false, sortOrder: 17, meta: EXTENDED },
    { ...MEASURED, pointKey: "oa_damper_pct", label: "Outdoor air damper position", unit: "%", required: false, sortOrder: 18, meta: EXTENDED },
    { ...MEASURED, pointKey: "ra_damper_pct", label: "Return air damper position", unit: "%", required: false, sortOrder: 19, meta: EXTENDED },
    { ...MEASURED, pointKey: "filter_dp_pa", label: "Filter differential pressure", unit: "Pa", required: true, sortOrder: 20, meta: CORE },
    { ...MEASURED, pointKey: "filter_dirty_state", label: "Filter dirty switch", unit: null, required: false, sortOrder: 21, meta: EXTENDED },
    { ...MEASURED, pointKey: "return_air_co2_ppm", label: "Return air CO₂", unit: "ppm", required: false, sortOrder: 22, meta: EXTENDED },
    { ...MEASURED, pointKey: "fire_trip_state", label: "Fire / smoke trip input", unit: null, required: true, sortOrder: 23, meta: CORE },
    { ...MEASURED, pointKey: "kw", label: "Unit input power", unit: "kW", required: false, sortOrder: 24, meta: EXTENDED },
    { ...MEASURED, pointKey: "run_hours_h", label: "Run hours", unit: "h", required: true, sortOrder: 25, meta: CORE },
    // Derived, appended after the table rows in the order §6's own Derived: line
    // names the two this entry authors. No meta.tier: the C/X/M column says what
    // the plant has FITTED, and a computed point is fitted by nobody.
    //
    // SIGNED ON PURPOSE — reading minus setpoint. Reversed, the same magnitude
    // means the opposite fault, and the two have opposite remedies.
    {
      ...derived("{supply_air_temp_c} - {supply_air_temp_sp_c}"),
      pointKey: "sat_deviation_c",
      label: "Supply air temperature deviation from setpoint",
      unit: "°C",
      required: false,
      sortOrder: 26,
    },
    // The same formula string as the chiller's chw_delta_t_c, over the same two
    // codes — two codes, one string, kept apart by plan §12 ruling 4: one is the
    // plant loop delta-T at the machine and this is the delta-T across one coil.
    // Both inputs are tier X, which is legal (declared, not required).
    {
      ...derived("{chw_return_temp_c} - {chw_supply_temp_c}"),
      pointKey: "coil_delta_t_c",
      label: "Coil chilled water ΔT",
      unit: "°C",
      required: false,
      sortOrder: 27,
    },
  ],
};
