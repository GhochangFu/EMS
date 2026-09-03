import { CORE, EXTENDED, MEASURED, derived } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The facility pack's occupancy-zone class — `E5.3`, ADR 0054 decisions 1-9, ADR
 * 0052 decisions 1, 2 and 6, ADR 0019 Amendment 2.
 *
 * **SOURCE.** `docs/e5.3-derived-taglist-v1.md` §4 — *"Occupancy & space —
 * people-counting / presence per zone"*. PROVISIONAL: derived from published
 * practice, not client-confirmed. The section's own framing is what fixes this
 * entry's shape: the zone **feeds** HVAC and lighting demand control and the
 * hotel and office space numbers. It is a SENSING asset, not a controlled one —
 * nothing on it commands anything, and the demand-control loop it feeds lives on
 * the AHU and the lighting zone.
 *
 * **ONE TEMPLATE INSTANCE PER COUNTED ZONE** — a floor plate, a meeting room, a
 * lobby, a hotel public area. A building-level occupancy roll-up is a hierarchy
 * tag and not another instance of this template, exactly as §1's lighting
 * roll-up is.
 *
 * **11 POINTS — 2 core + 8 extended + 0 manual + 1 DERIVED.** §4's 10 table rows
 * in the document's own order (`sortOrder` 0-9) and `occupancy_pct` appended at
 * 10. **The pack's smallest entry**, and its two `C` rows are the two questions
 * the section exists to answer: is anyone here, and how warm is it.
 *
 * ---
 *
 * **THIS ENTRY SITS ON BOTH SIDES OF THE FIRST-OCCURRENCE RULE** (ADR 0054
 * decision 3).
 *
 *  - **`occupancy_state` is REFERENCED, not declared.** §1's lighting zone is
 *    its first occurrence in the document, so it is filed under `facility`
 *    there. A tier is per ENTRY and it is `core` on both, for two different
 *    reasons: the lighting zone cannot run its control strategy without
 *    presence, and a zone that counts people needs to know whether anybody is
 *    in it before any of the counts mean anything.
 *  - **`entry_count`, `exit_count` and `sensor_battery_pct` are DECLARED here**
 *    for later sections. §5's parking level uses the two counters for VEHICLES
 *    rather than people — one code, one meaning (*things that crossed the
 *    boundary inward, in the interval*), two assets — and §6's IAQ node reuses
 *    the battery row. Neither redeclares them.
 *
 * ---
 *
 * **ONE DERIVED CODE PROMOTED, AND IT IS THE FIRST OF TWO AUTHORINGS.**
 * `occupancy_pct` = `{occupancy_count} / {occupancy_capacity} * 100`, and §5's
 * parking level authors the SAME code over `{bays_occupied} / {bays_total} *
 * 100`. **That is one code with one meaning — the fraction of a space's design
 * capacity that is in use — expressed over each asset's own rows**, and it is
 * the `recovery_pct` shape `E5.1` set on the WTP and the RO. It is not a clash
 * and must never be "fixed" by minting a second code;
 * `facility-classes-2.spec.ts` asserts both formulas from the parking-level
 * block, which is the second authoring and therefore where a copy-paste bug
 * would land.
 *
 * **ADR 0054 SKETCHED THIS CODE AS ATTRIBUTE-DEFERRED, and plan §12 ruling 2
 * overturned that on the document's own row.** The ADR assumed the capacity was
 * an asset attribute `bms-calc-v1` cannot read. §4 declares
 * `occupancy_capacity` as a POINT — the *(attribute-as-point)* row — so the
 * grammar can name it and the ratio is expressible. The rule did not change; the
 * document turned out to satisfy it.
 *
 * `maxInputAgeSeconds` is `null`, the 300 s default: the count and the capacity
 * arrive from the same sensor gateway. The pack's only two overrides are on §6's
 * IAQ node, whose outdoor reference may come from a weather API. **A zone whose
 * capacity was never commissioned divides by zero and `evaluate.ts` returns
 * `non_finite`** — no value, never a wrong one, and nothing here is clamped.
 *
 * Both inputs are `X`, which is deliberate: a site that fits presence detection
 * but no counter, or a counter but no commissioned capacity, gets no ratio. That
 * is the honest answer and it is why the row is optional.
 *
 * **THREE DERIVED CODES ARE DEFERRED AND NAMED, never placeholdered** (ADR 0054
 * decision 6; ADR 0051 Amendment 6 decision 8):
 *
 *  - **A time window the grammar has no state for** — `occupied_hours_day`.
 *    `bms-calc-v1` has arithmetic, parentheses and five functions and no clock
 *    and no memory.
 *  - **An asset attribute the grammar cannot read** — `space_utilization_pct`
 *    needs the DESK or ROOM count, and `occupancy_capacity` is not that
 *    denominator: the capacity is what the space may safely hold and the desk
 *    count is what it was furnished with. Dividing by the wrong one gives a
 *    number that looks right, which is why this is deferred rather than
 *    approximated.
 *  - **Another asset's meter** — `conditioning_while_empty_kwh` needs the HVAC
 *    zone's energy, and a formula may reference only measured points of its own
 *    entry.
 *
 * **NO `content.kpis`** (ADR 0054 decision 6): every ratio §4 names is either the
 * point above or one of the three deferrals.
 *
 * ---
 *
 * **FOUR ALARMS FROM FIVE BULLETS, AND THE FIFTH IS RECORDED RATHER THAN
 * INVENTED** (plan §12 ruling 6) — the pack's SECOND dropped bullet, after §1's.
 * §4's *Alarms* line names *sensor offline*, and §4's table carries **no
 * `sensor_online` row**. §6's IAQ node is the section that declares one.
 *
 * This bullet is the more tempting of the two to rehome, precisely because a
 * nearly-identical row exists one section away — and rehoming it would bind an
 * alarm to a key this template does not declare, which fails
 * `assertContentRefsResolve` at import on a client's site. So it is a **v2
 * redline candidate for the `F2.18` handout**, and the health signal this entry
 * does carry is `sensor_battery_low`: a wireless node's battery is the failure
 * that precedes its silence.
 *
 * **`occupancy_over_capacity` BINDS THE DERIVED POINT**, which is shipped
 * behaviour and not a novelty — `recovery_low` binds `recovery_pct` on
 * `water-ro`. Binding the raw count instead would need whoever writes the rule
 * to know the capacity, which is exactly the number the derived point already
 * divides by.
 *
 * **IT IS THE ONE ROW HERE WITH NO `skill`** (plan §12 ruling 4): a zone over
 * its egress capacity is answered by whoever manages the space and by the fire
 * strategy, and `bms.alarm_skills` holds `electrical`, `mechanical`, `hvac`,
 * `controls` and `civil` — none of which is either. The other three rows are a
 * sensor binding (`controls`), a comfort band (`hvac`) and a battery round
 * (`controls`).
 *
 * **EVERY ALARM IS PAIR-ABSENT AND CARRIES A POPULATED `philosophy`** — no
 * `thresholdValue`, no `operator` (ADR 0019 Amendment 2, ADR 0054 decision 5,
 * B7). The egress capacity, the comfort band and the battery level are all site
 * values: a lobby and a meeting room do not answer them the same way, and the
 * capacity itself is a point on this entry rather than a number in this file.
 *
 * `counter_drift` binds `entry_count` and NAMES `exit_count` in its message,
 * because `bms-calc-v1` has no running difference and the rule reads the second
 * counter beside the first (`E2.4`). A message that does not say which second row
 * the rule needs is a rule nobody can write.
 *
 * ---
 *
 * **MAINTENANCE — 2 plans, PROVISIONAL** (ADR 0054 decision 8), derived from
 * wireless-sensor and people-counter service practice, because the tag list has
 * no maintenance section. **Neither is `safetyCritical`, and that is authored
 * rather than omitted**: the egress question this entry raises is answered by
 * the `occupancy_over_capacity` alarm, which fires now, and marking a battery
 * round critical would flatten the distinction the fire panel's battery test and
 * the access door's fire-release test depend on. **No `condition_based` plan**
 * either — a battery is replaced on a round and a counter is recalibrated on a
 * schedule, and `sensor_battery_low` is an alarm somebody answers rather than a
 * condition a plan watches.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the site's
 * telemetry wiring — here the sensor gateway's object for this zone — which the
 * tag list does not know and the catalog must not guess. An imported draft
 * cannot be instantiated until an operator fills the patterns in.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `facility-occupancy-zone` **v1** (2026-09-04, `E5.3`): authored from
 *    `e5.3-derived-taglist-v1.md` §4, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const FACILITY_OCCUPANCY_ZONE: StockAssetTemplateEntry = {
  code: "facility-occupancy-zone",
  name: "Occupancy and space zone",
  assetType: "occupancy_zone",
  domain: "facility",
  description:
    "One counted or sensed zone — a floor plate, a meeting room, a lobby or a hotel public area " +
    "— reporting presence, a people count against the zone's design capacity, entry and exit " +
    "counts, occupied desks or rooms, the zone's own temperature, humidity and setpoint, and a " +
    "wireless sensor's battery. It is a sensing asset and commands nothing: the demand-control " +
    "loop it feeds lives on the air handling unit and the lighting zone, and a building-level " +
    "roll-up is a hierarchy tag rather than another instance of this template. Authored from " +
    "docs/e5.3-derived-taglist-v1.md §4 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required and X optional; alarm rows carry a meaning " +
    "and no limit, because the egress capacity, the comfort band and the battery level are set " +
    "per zone at commissioning. One derived point is authored — occupancy against the declared " +
    "capacity, the same code the parking level authors over its own bays — and three of the " +
    "section's derived codes are deferred and named: a time window, a desk count the zone does " +
    "not report, and an air handling unit's energy meter.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "occupancy_over_capacity",
        pointKey: "occupancy_pct",
        severity: "critical",
        category: "safety",
        message:
          "Zone occupancy above its design capacity. The capacity is a point on this asset and " +
          "is set per zone at commissioning, from the space's egress provision — not a value " +
          "this template ships.",
        philosophy: {
          cause:
            "An event or a shift larger than the space was designed for, a hall or lobby used " +
            "for something it was not planned around, a counter that has drifted upward and is " +
            "over-reporting, or a commissioned capacity that was entered for a different room.",
          impact:
            "More people are in the space than its escape routes were sized for, which is an " +
            "evacuation question rather than a comfort one. The ventilation and the lighting " +
            "demand loops this zone feeds are also being driven past the load they were " +
            "designed for, so the space gets warm and stuffy at the same time.",
          action:
            "Whoever manages the space answers this, with the fire strategy behind them — it is " +
            "not a maintenance call and there is no trade to route it to. Confirm the count " +
            "against what a person can see before acting on it: a drifted counter and a full " +
            "room look identical from here, and the counter calibration round is what tells " +
            "them apart.",
        },
      },
      {
        code: "counter_drift",
        pointKey: "entry_count",
        severity: "warning",
        category: "operations",
        message:
          "Entries and exits diverging — the rule reads exit_count beside this counter, and the " +
          "gap that matters and the period it is measured over are the site's.",
        philosophy: {
          cause:
            "A counter that misses people walking side by side or in a group, a sensor knocked " +
            "out of aim or masked by signage or a plant pot, a door in the zone that is not " +
            "counted at all, or a camera analytic whose scene changed when the furniture moved.",
          impact:
            "The occupancy count that everything else on this zone rests on is wrong, and it " +
            "drifts further every interval because the error accumulates. The demand-control " +
            "loops fed from it then over- or under-ventilate the space, and the " +
            "occupancy_over_capacity row becomes either permanent furniture or permanently " +
            "silent.",
          action:
            "Re-aim and recount against a manual observation at a busy period, which is the " +
            "calibration plan on this entry. If the divergence returns quickly, look for an " +
            "uncounted door before adjusting the sensor again — an unwatched route is the usual " +
            "answer and no amount of recalibration fixes it.",
          skill: "controls",
        },
      },
      {
        code: "zone_temp_out_of_band_occupied",
        pointKey: "zone_temp_c",
        severity: "warning",
        category: "comfort",
        message:
          "Zone temperature outside its comfort band while the zone is occupied. " +
          "zone_temp_sp_c is the reference and the band around it is the site's, set per space " +
          "type at commissioning.",
        philosophy: {
          cause:
            "A terminal unit or damper that has stopped responding, a setpoint changed locally " +
            "and left there, a zone whose load grew when it was re-partitioned or re-occupied, " +
            "or a supply the air handling unit can no longer meet at this hour.",
          impact:
            "The occupants are uncomfortable, which is what generates the complaints that arrive " +
            "hours later with no data behind them. This row is the data behind them, and it is " +
            "filed comfort rather than operations for that reason.",
          action:
            "Check the setpoint and the terminal unit for this zone first, then the air handling " +
            "unit serving it. The row only fires while the zone is occupied, so an out-of-band " +
            "reading overnight is a setback and not a fault.",
          skill: "hvac",
        },
      },
      {
        code: "sensor_battery_low",
        pointKey: "sensor_battery_pct",
        severity: "info",
        category: "operations",
        message:
          "Wireless sensor battery low. The level that means low is the node's own and is set " +
          "per site, because the reserve a battery holds depends on how often the node reports.",
        philosophy: {
          cause:
            "A battery at the end of its service life, a node reporting far more often than it " +
            "was commissioned to because the zone is busy, or a cold location that shortens the " +
            "cell's useful output.",
          impact:
            "Nothing yet, which is why this row is informational. What follows is silence: the " +
            "node stops reporting and the zone's presence, count and temperature all go stale " +
            "at once, with no row on this entry to say so — §4's table carries no online flag " +
            "and the missing bullet is a redline for the handout.",
          action:
            "Add the node to the next battery replacement round rather than making a visit for " +
            "it. A whole zone's nodes were usually commissioned together and will run down " +
            "together, so replace the round rather than the cell.",
          skill: "controls",
        },
      },
    ],
    maintenance: [
      {
        title: "Sensor battery replacement round",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 30,
        priority: "low",
        safetyCritical: false,
        triggerSummary:
          "Replace the cells in the zone's wireless presence, counting and temperature nodes and " +
          "confirm sensor_battery_pct recovers on each. A zone's nodes were commissioned " +
          "together and run down together, so this is a round and not a call-out — and a node " +
          "that goes silent takes the zone's presence, count and temperature with it.",
      },
      {
        title: "People-counter calibration and drift check",
        category: "calibration",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 45,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Count the zone by hand at a busy period and compare against entry_count and " +
          "exit_count over the same window, then re-aim or re-tune the sensor or the camera " +
          "analytic. Check for a door or route into the zone that nothing counts before " +
          "adjusting anything: an unwatched route is the usual cause of divergence and no " +
          "amount of recalibration fixes it. This is the task that clears counter_drift and " +
          "that keeps the occupancy count everything else on this zone rests on honest.",
      },
    ],
  },
  points: [
    // Referenced, not declared — §1's lighting zone owns this code's declaration
    // (ADR 0054 decision 3, first-occurrence-wins). A tier is per entry and it
    // is core on both: presence is what makes every count below it meaningful.
    { ...MEASURED, pointKey: "occupancy_state", label: "Zone occupied (presence)", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "occupancy_count", label: "People in zone (counter / camera analytics)", unit: null, required: false, sortOrder: 1, meta: EXTENDED },
    // The attribute-as-point row, and the reason occupancy_pct is authorable at
    // all: the capacity is a POINT the zone reports, so bms-calc-v1 can name it.
    { ...MEASURED, pointKey: "occupancy_capacity", label: "Design capacity", unit: null, required: false, sortOrder: 2, meta: EXTENDED },
    // Declared HERE for §5's parking level, which counts VEHICLES over the same
    // two codes — one meaning, two assets.
    { ...MEASURED, pointKey: "entry_count", label: "Entries", unit: null, required: false, sortOrder: 3, meta: EXTENDED },
    { ...MEASURED, pointKey: "exit_count", label: "Exits", unit: null, required: false, sortOrder: 4, meta: EXTENDED },
    { ...MEASURED, pointKey: "desk_occupied_count", label: "Occupied desks / rooms (booking or sensor)", unit: null, required: false, sortOrder: 5, meta: EXTENDED },
    { ...MEASURED, pointKey: "zone_temp_c", label: "Zone air temperature", unit: "°C", required: true, sortOrder: 6, meta: CORE },
    { ...MEASURED, pointKey: "zone_rh_pct", label: "Zone relative humidity", unit: "%", required: false, sortOrder: 7, meta: EXTENDED },
    { ...MEASURED, pointKey: "zone_temp_sp_c", label: "Zone temperature setpoint", unit: "°C", required: false, sortOrder: 8, meta: EXTENDED },
    // Declared HERE for §6's IAQ node, which reuses it for its own wireless
    // nodes.
    { ...MEASURED, pointKey: "sensor_battery_pct", label: "Wireless sensor battery", unit: "%", required: false, sortOrder: 9, meta: EXTENDED },
    // Derived, appended after the table rows. No meta.tier: the C/X/M column
    // says what the zone HAS FITTED, and a computed point is fitted by nobody.
    // The SAME code is authored on facility-parking-level over its own bays —
    // one meaning, two formulas, the recovery_pct shape. A zone whose capacity
    // was never commissioned divides by zero and evaluate.ts returns
    // non_finite, which is why nothing here is clamped.
    {
      ...derived("{occupancy_count} / {occupancy_capacity} * 100"),
      pointKey: "occupancy_pct",
      label: "Occupancy against design capacity",
      unit: "%",
      required: false,
      sortOrder: 10,
    },
  ],
};
