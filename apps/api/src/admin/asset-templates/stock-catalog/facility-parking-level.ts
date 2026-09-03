import { CORE, EXTENDED, MEASURED, derived } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The facility pack's parking-level class — `E5.3`, ADR 0054 decisions 1-9, ADR
 * 0052 decisions 1, 2 and 6, ADR 0019 Amendment 2.
 *
 * **SOURCE.** `docs/e5.3-derived-taglist-v1.md` §5 — *"Parking — level / bay
 * guidance and barrier"*. PROVISIONAL: derived from published practice, not
 * client-confirmed. The section's basis is a **bay-guidance system with
 * ultrasonic or camera bay sensors, entry and exit barriers, basement gas
 * detection driving the ventilation, and an EV charger cluster** — four
 * subsystems on one level, which is what makes this entry a LEVEL rather than a
 * device.
 *
 * **ONE TEMPLATE INSTANCE PER PARKING LEVEL** — a basement, a podium deck, a
 * surface lot. A whole car park's free-bay total is a hierarchy roll-up and not
 * another instance of this template, exactly as §1's building-level lighting
 * roll-up is.
 *
 * **17 POINTS — 5 core + 11 extended + 0 manual + 1 DERIVED.** §5's 16 table
 * rows in the document's own order (`sortOrder` 0-15) and `occupancy_pct`
 * appended at 16.
 *
 * ---
 *
 * **`co_ppm` IS `core` HERE AND `extended` ON §6's IAQ NODE — the pack's
 * dual-tier row** (ADR 0054 decision 4). The code is declared once, under
 * `facility`, because §5 is its first occurrence in the document (decision 3),
 * and **a tier is per ENTRY**. Core here because a basement carbon monoxide
 * sensor IS the ventilation interlock: a level without one has no way to know it
 * needs to run its fans, and the `co_high` row below is this entry's life-safety
 * one. Extended there because on an indoor air quality node carbon monoxide is
 * one pollutant among nine on a comfort sensor. This is exactly the shape
 * `effluent_cod_mgl` has on the sewage plant and the effluent plant, and
 * `facility-classes-2.spec.ts` and `-3` assert one half each.
 *
 * **`entry_count` AND `exit_count` ARE REFERENCED, not declared.** §4's
 * occupancy zone is their first occurrence, so they are filed there. Here they
 * count VEHICLES rather than people — one code, one meaning (*things that
 * crossed the boundary inward, in the interval*), two assets, and neither
 * redeclares the other's.
 *
 * **`no2_ppm` HERE IS NOT §6's `no2_ppb`.** Two quantities at two ranges: a
 * basement's diesel exhaust in parts per million, and an indoor node's trace
 * measurement in parts per billion. They are deliberately not normalised into
 * one code — the spelling says which measurement was made (ADR 0053 decision 9's
 * reasoning). `ev_charger_kw` and `ev_charger_kwh_total` are likewise not the
 * electrical pack's `kw` and `kwh_total`: the prefix says the charger cluster
 * reported it and not the level's own supply.
 *
 * ---
 *
 * **ONE DERIVED CODE PROMOTED, AND IT IS THE SECOND OF TWO AUTHORINGS.**
 * `occupancy_pct` = `{bays_occupied} / {bays_total} * 100`, and §4's occupancy
 * zone authors the SAME code over `{occupancy_count} / {occupancy_capacity} *
 * 100`. **One code with one meaning — the fraction of a space's design capacity
 * that is in use — expressed over each asset's own rows**, the `recovery_pct`
 * shape `E5.1` set on the WTP and the RO. It is not a clash and must never be
 * "fixed" by minting a second code.
 *
 * Both inputs are `C` here, unlike §4's, where both are `X`: a guidance system
 * that does not know its bay count or its occupied count is not a guidance
 * system. `maxInputAgeSeconds` is `null` — the bay sensors report on one network
 * at one rate; the pack's only two overrides are on §6's IAQ node, whose outdoor
 * reference may come from a weather API. **A level with a zero bay total divides
 * by zero and `evaluate.ts` returns `non_finite`** — no value, never a wrong
 * one, and nothing here is clamped.
 *
 * **FOUR DERIVED CODES ARE DEFERRED AND NAMED, and they are the pack's only list
 * that is all one class** (ADR 0054 decision 6; ADR 0051 Amendment 6 decision 8):
 * `turnover_per_day`, `avg_dwell_min`, `fan_hours_day` and `co_driven_fan_pct`
 * are **all time windows**. `bms-calc-v1` has arithmetic, parentheses and five
 * functions and no clock and no memory, so vehicles per day, average dwell (which
 * additionally needs entry-to-exit pairing), fan hours per day and the fraction
 * of those hours that gas demand drove — two windows, not one — are none of them
 * expressible. Every one of the four is the rule engine's to evaluate (`E2.4`)
 * over points this entry already declares.
 *
 * **NO `content.kpis`** (ADR 0054 decision 6): every ratio §5 names is either the
 * point above or one of the four deferrals.
 *
 * ---
 *
 * **SEVEN ALARMS FROM SEVEN BULLETS — nothing dropped, nothing invented.**
 *
 * **`co_high` IS `critical` / `safety` AND IS THE LIFE-SAFETY ONE**, which the
 * section says outright. A basement fills with exhaust when the ventilation
 * stops, and carbon monoxide is the gas that kills before anybody notices it.
 * Filing it as an operations warning beside the fan fault is how it gets read as
 * a ventilation nuisance. `no2_high` is the diesel marker beside it and is a
 * `warning`: it says the mix is wrong before the carbon monoxide row says the
 * air is dangerous.
 *
 * **SIX OF THE SEVEN ROWS CARRY A `skill`.** The two gas rows are `hvac`,
 * because what answers them is ventilation; the jet fan and the barrier are
 * `mechanical`, because both are machines with a motor and a linkage; the
 * guidance network and the bay-count inconsistency are `controls`, because both
 * are sensor bindings.
 *
 * **`level_full` CARRIES NONE, AND IT IS A THIRD UNANSWERABLE CLASS.** The pack
 * so far has life-safety rows (the fire panel's events) and security rows (the
 * access door's). A car park with no free bays is neither: it is a FACT about
 * how busy the building is, nothing is broken, and no maintenance trade answers
 * it. The car-park operator opens another level or turns the entry sign. Filing
 * it under `controls` to make the map tidy would route a full car park to a
 * trade that then has to work out why it was called — the exact failure the
 * omission exists to prevent. It is `info` for the same reason.
 *
 * **EVERY ALARM IS PAIR-ABSENT AND CARRIES A POPULATED `philosophy`** — no
 * `thresholdValue`, no `operator` (ADR 0019 Amendment 2, ADR 0054 decision 5,
 * B7). The gas levels that trip the fans, the free-bay count that means full and
 * the tolerance on the bay arithmetic are all commissioning values, set per level
 * against that basement's ventilation design and its own bay layout.
 *
 * `bay_count_inconsistent` binds `bays_occupied` and NAMES `bays_free` and
 * `bays_total` in its message, because `bms-calc-v1` expresses no equality and
 * the rule reads the other two beside it (`E2.4`).
 *
 * ---
 *
 * **MAINTENANCE — 4 plans, PROVISIONAL** (ADR 0054 decision 8), derived from
 * gas-detection, ventilation and barrier service practice, because the tag list
 * has no maintenance section. **None is `safetyCritical`, and that is authored
 * rather than omitted**: the gas calibration is the closest — it is what keeps
 * the life-safety `co_high` row honest — and it is calibration work on a
 * ventilation interlock rather than a statutory test. ADR 0054 decision 8 names
 * ten critical plans across the pack and none of them is on this entry.
 *
 * **One plan IS `condition_based`** — the bay-sensor network check, generated
 * when the three bay counts stop agreeing, and it names all three rows because a
 * condition plan that does not say what condition generates it is a calendar
 * plan with a different word on it.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the site's
 * telemetry wiring — here the guidance controller's or the gas panel's object —
 * which the tag list does not know and the catalog must not guess. An imported
 * draft cannot be instantiated until an operator fills the patterns in.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `facility-parking-level` **v1** (2026-09-04, `E5.3`): authored from
 *    `e5.3-derived-taglist-v1.md` §5, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const FACILITY_PARKING_LEVEL: StockAssetTemplateEntry = {
  code: "facility-parking-level",
  name: "Parking level (guidance and barrier)",
  assetType: "parking_level",
  domain: "facility",
  description:
    "One parking level — a basement, a podium deck or a surface lot — with its bay guidance, " +
    "its entry and exit barriers, its basement gas detection and ventilation, and its EV " +
    "charger cluster: total, occupied, free and free EV bays, barrier states and faults, vehicle " +
    "entry and exit counts, carbon monoxide and nitrogen dioxide, the jet fan run status and " +
    "fault, the bay-sensor network's health, and the charger cluster's power and energy. Carbon " +
    "monoxide is a required point here because it is the ventilation interlock: a level that " +
    "cannot measure it has no way to know it needs to run its fans. A whole car park's free-bay " +
    "total is a hierarchy roll-up, not another instance of this template. Authored from " +
    "docs/e5.3-derived-taglist-v1.md §5 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required and X optional; alarm rows carry a meaning " +
    "and no limit, because the gas levels that trip the fans and the free-bay count that means " +
    "full are set per level at commissioning against that basement's ventilation design. One " +
    "derived point is authored — occupancy over the level's own bays, the same code the " +
    "occupancy zone authors over its people count — and four of the section's derived codes are " +
    "deferred and named, all four of them time windows the rule engine evaluates.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "co_high",
        pointKey: "co_ppm",
        severity: "critical",
        category: "safety",
        message:
          "Basement carbon monoxide high — either the ventilation is not meeting the demand or " +
          "it has failed. The level that trips the fans and the level that means danger are both " +
          "set per basement at commissioning, against that car park's ventilation design.",
        philosophy: {
          cause:
            "Jet or extract fans not running when they were called, a fan that has failed with " +
            "no fault reported, a queue of idling vehicles at a barrier that will not lift, an " +
            "extract path blocked or a damper closed, or a gas sensor that has drifted and is " +
            "over-reading.",
          impact:
            "Carbon monoxide is colourless and odourless and it takes people down before they " +
            "know it is there. Anybody walking to a car, and anybody sitting in a queue with a " +
            "window open, is breathing it. This is the row on this entry that is about people " +
            "rather than about parking.",
          action:
            "Confirm the fans are running and clear the basement if they are not — that order, " +
            "and it is an immediate response rather than a work order. Then find why: a fan " +
            "that did not start, a queue that should not have formed, or a sensor that needs the " +
            "calibration round. A reading that stays high with the fans confirmed running is a " +
            "reason to keep the level closed.",
          skill: "hvac",
        },
      },
      {
        code: "no2_high",
        pointKey: "no2_ppm",
        severity: "warning",
        category: "safety",
        message:
          "Basement nitrogen dioxide high — the diesel marker. The level is set per basement at " +
          "commissioning, and it is a different question from the carbon monoxide one beside it.",
        philosophy: {
          cause:
            "Diesel vehicles idling or manoeuvring in a poorly swept part of the level, a " +
            "delivery bay or a coach bay inside the envelope, ventilation sized for petrol " +
            "traffic, or an extract path that does not reach where the diesel traffic actually " +
            "stands.",
          impact:
            "Nitrogen dioxide irritates the airway at levels far below anything that would show " +
            "on the carbon monoxide row, so this is the row that says the mix is wrong before " +
            "the other says the air is dangerous. Long exposure is the concern for staff who " +
            "work on the level rather than for drivers who pass through it.",
          action:
            "Run the ventilation and look at where the diesel traffic stands rather than at the " +
            "sensor. If the extract does not reach that part of the level, that is a ventilation " +
            "design finding and not a fault, and it belongs in a report rather than in a repair.",
          skill: "hvac",
        },
      },
      {
        code: "jet_fan_fault",
        pointKey: "jet_fan_fault",
        severity: "warning",
        category: "operations",
        message:
          "Ventilation or jet fan fault reported. The fan is the level's answer to both gas " +
          "rows, so this row is what turns a warning into a closure if it is left.",
        philosophy: {
          cause:
            "A tripped overload or a failed starter, a seized or unbalanced impeller, a damaged " +
            "mounting on a jet fan hung from the soffit, or a control link that has lost the " +
            "fan's status while the fan itself is fine.",
          impact:
            "The level's ability to clear exhaust is reduced, and on a basement with few fans it " +
            "may be gone. Nothing is unsafe yet — that is what the gas rows are for — but the " +
            "thing that answers those rows has stopped answering.",
          action:
            "Check the starter and the overload first, then the fan itself. A jet fan hung over " +
            "a driveway is also a fixings inspection when it is reached, because the mounting is " +
            "the failure nobody plans for. Treat a fan fault on a level whose gas readings are " +
            "already rising as an urgent job rather than a scheduled one.",
          skill: "mechanical",
        },
      },
      {
        code: "level_full",
        pointKey: "bays_free",
        severity: "info",
        category: "operations",
        message:
          "No free bays on this level. The free-bay count that means full is the site's — a " +
          "level that keeps a reserve for permit holders answers it differently from one that " +
          "does not.",
        philosophy: {
          cause:
            "The level is genuinely full, a shift or an event has filled it, or bay sensors are " +
            "reporting occupied on empty bays and the free count has fallen without the cars " +
            "arriving.",
          impact:
            "Drivers circulate looking for a bay that is not there, which adds exhaust to a " +
            "basement and queues to a ramp. Nothing is broken, which is why this row is " +
            "informational and why it carries no trade.",
          action:
            "The car-park operator answers this — open another level, turn the entry sign, or " +
            "hold traffic at the barrier. If the level reports full while a walk of it shows " +
            "empty bays, that is the bay-sensor question and the condition-based network check " +
            "is where it belongs.",
        },
      },
      {
        code: "barrier_fault",
        pointKey: "barrier_fault",
        severity: "warning",
        category: "operations",
        message:
          "Barrier or loop-detector fault on the entry or the exit. Which of the two it is comes " +
          "from the barrier state rows beside this one.",
        philosophy: {
          cause:
            "A bent or struck boom, a failed drive or gearbox in the barrier housing, a ground " +
            "loop that has been cut or has flooded, or a detector card that no longer sees a " +
            "vehicle over the loop.",
          impact:
            "A barrier stuck down holds traffic on the ramp and outside the building; a barrier " +
            "stuck up lets everybody in unrecorded and unbilled. A failed loop is the more " +
            "insidious of the three because the barrier still works and simply misses vehicles, " +
            "which quietly corrupts the entry and exit counts everything else reads.",
          action:
            "Look at the boom and the housing first, then the loop. A loop fault after wet " +
            "weather is water in the slot and is a civil repair rather than an electrical one, " +
            "so confirm which before the trade is sent.",
          skill: "mechanical",
        },
      },
      {
        code: "guidance_network_offline",
        pointKey: "guidance_comms_ok",
        severity: "warning",
        category: "operations",
        message:
          "Bay-sensor network down. The bay counts on this level are now stale and will hold " +
          "their last values until it returns.",
        philosophy: {
          cause:
            "A failed network segment or repeater on the level, a controller that stopped " +
            "polling the sensor bus, a power supply lost on one arm of the guidance system, or " +
            "damage during other work in the basement soffit.",
          impact:
            "Occupied, free and EV-free bays all freeze, and the derived occupancy freezes with " +
            "them. The signage keeps showing a number, which is worse than showing none: drivers " +
            "are directed to a level on the strength of a count that stopped moving.",
          action:
            "Follow the network segment rather than the sensors — a whole level going quiet at " +
            "once is a bus or a supply and not a bay. Check what other work has been done in the " +
            "soffit recently; guidance cabling runs where everything else runs.",
          skill: "controls",
        },
      },
      {
        code: "bay_count_inconsistent",
        pointKey: "bays_occupied",
        severity: "warning",
        category: "operations",
        message:
          "Occupied and free bays do not add up to the level's total — the rule reads bays_free " +
          "and bays_total beside this count. The tolerance is the site's, because a level with " +
          "bays out of service for works is legitimately short.",
        philosophy: {
          cause:
            "Bay sensors stuck occupied on empty bays or stuck free under parked cars, sensors " +
            "that dropped off the network without the network itself failing, bays coned off for " +
            "works that the total was never adjusted for, or a commissioned total that no longer " +
            "matches the layout after a re-marking.",
          impact:
            "Every count on this level is now suspect, and so is the derived occupancy computed " +
            "from two of them. The guidance signage and the level_full row are both driven from " +
            "numbers that no longer describe the level.",
          action:
            "Walk the level and compare bay for bay — this is the condition-based network check " +
            "on this entry. Correct the commissioned total first if the layout changed, because " +
            "re-tuning sensors against a wrong total chases an error that is not in the sensors.",
          skill: "controls",
        },
      },
    ],
    maintenance: [
      {
        title: "CO / NO₂ sensor calibration",
        category: "calibration",
        generationMode: "calendar",
        intervalDays: 180,
        estimatedMinutes: 60,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Gas-check and re-span the basement carbon monoxide and nitrogen dioxide heads against " +
          "certified gas, and confirm co_ppm and no2_ppm track it. This is the task that keeps " +
          "the life-safety co_high row honest: an electrochemical cell loses output over its " +
          "life and a drifted head under-reads silently, so a level with a calm panel and an " +
          "uncalibrated sensor is the worst combination on this entry. Confirm the fan call " +
          "fires on a test gas before leaving.",
      },
      {
        title: "Jet fan and ventilation run test",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 30,
        estimatedMinutes: 45,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Run each jet and extract fan on the level, confirm jet_fan_status reports it and " +
          "listen for bearing noise and imbalance. Check the soffit fixings on any fan hung over " +
          "a driveway while it is reached. A fan that has not run since the last test is a fan " +
          "nobody knows the state of, and it is the level's only answer to both gas rows.",
      },
      {
        title: "Barrier and loop-detector service",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 60,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Service the entry and exit barrier drives and booms, and check each ground loop and " +
          "its detector card against a vehicle. A loop that has taken water or been cut misses " +
          "vehicles while the barrier still works, which corrupts the entry and exit counts " +
          "quietly rather than raising barrier_fault.",
      },
      {
        title: "Bay-sensor network check on inconsistency",
        category: "condition_based",
        generationMode: "condition",
        intervalDays: 30,
        estimatedMinutes: 60,
        priority: "low",
        safetyCritical: false,
        triggerSummary:
          "Generated when bays_occupied and bays_free stop adding up to bays_total. Walk the " +
          "level bay for bay and find the sensors stuck occupied on empty bays or stuck free " +
          "under parked cars. Correct the commissioned total FIRST if the layout changed or bays " +
          "were coned off for works: re-tuning sensors against a wrong total chases an error " +
          "that is not in the sensors.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "bays_total", label: "Bays on level", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "bays_occupied", label: "Occupied bays (ultrasonic / camera)", unit: null, required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "bays_free", label: "Free bays", unit: null, required: true, sortOrder: 2, meta: CORE },
    { ...MEASURED, pointKey: "ev_bays_free", label: "Free EV-charging bays", unit: null, required: false, sortOrder: 3, meta: EXTENDED },
    { ...MEASURED, pointKey: "entry_barrier_state", label: "Entry barrier up / down", unit: null, required: false, sortOrder: 4, meta: EXTENDED },
    { ...MEASURED, pointKey: "exit_barrier_state", label: "Exit barrier up / down", unit: null, required: false, sortOrder: 5, meta: EXTENDED },
    { ...MEASURED, pointKey: "barrier_fault", label: "Barrier / loop detector fault", unit: null, required: false, sortOrder: 6, meta: EXTENDED },
    // Referenced, not declared — §4's occupancy zone owns both codes. Here they
    // count VEHICLES rather than people: one meaning, two assets.
    { ...MEASURED, pointKey: "entry_count", label: "Vehicle entries", unit: null, required: false, sortOrder: 7, meta: EXTENDED },
    { ...MEASURED, pointKey: "exit_count", label: "Vehicle exits", unit: null, required: false, sortOrder: 8, meta: EXTENDED },
    // The pack's dual-tier row. CORE here because a basement carbon monoxide
    // sensor IS the ventilation interlock; EXTENDED on §6's IAQ node, where the
    // same code is one pollutant among nine (ADR 0054 decision 4). Declared once,
    // under facility, because §5 is its first occurrence in the document.
    { ...MEASURED, pointKey: "co_ppm", label: "Basement CO (ventilation control)", unit: "ppm", required: true, sortOrder: 9, meta: CORE },
    // NOT §6's no2_ppb: a basement's diesel exhaust in ppm and an indoor node's
    // trace measurement in ppb are two quantities at two ranges.
    { ...MEASURED, pointKey: "no2_ppm", label: "Basement NO₂ (diesel)", unit: "ppm", required: false, sortOrder: 10, meta: EXTENDED },
    { ...MEASURED, pointKey: "jet_fan_status", label: "Ventilation / jet fan run", unit: null, required: true, sortOrder: 11, meta: CORE },
    { ...MEASURED, pointKey: "jet_fan_fault", label: "Ventilation fan fault", unit: null, required: false, sortOrder: 12, meta: EXTENDED },
    { ...MEASURED, pointKey: "guidance_comms_ok", label: "Bay-sensor network healthy", unit: null, required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "ev_charger_kw", label: "EV charger cluster power", unit: "kW", required: false, sortOrder: 14, meta: EXTENDED },
    { ...MEASURED, pointKey: "ev_charger_kwh_total", label: "EV charger cluster energy", unit: "kWh", required: false, sortOrder: 15, meta: EXTENDED },
    // Derived, appended after the table rows. No meta.tier: the C/X column says
    // what the level HAS FITTED, and a computed point is fitted by nobody. The
    // SAME code is authored on facility-occupancy-zone over its people count —
    // one meaning, two formulas, the recovery_pct shape. A level with a zero bay
    // total divides by zero and evaluate.ts returns non_finite, which is why
    // nothing here is clamped.
    {
      ...derived("{bays_occupied} / {bays_total} * 100"),
      pointKey: "occupancy_pct",
      label: "Occupied bays as a share of the level",
      unit: "%",
      required: false,
      sortOrder: 16,
    },
  ],
};
