import { CORE, EXTENDED, MANUAL, MEASURED, derived } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The facility pack's indoor-air-quality node — `E5.3`, ADR 0054 decisions 1-9,
 * ADR 0052 decisions 1, 2 and 6, ADR 0019 Amendment 2.
 *
 * **SOURCE.** `docs/e5.3-derived-taglist-v1.md` §6 — *"IAQ node — indoor air
 * quality sensor (per zone or per AHU return)"*. PROVISIONAL: derived from
 * published practice, not client-confirmed. The section's parameter set is
 * **ISHRAE IEQ and ASHRAE 62.1**, which is what fixes the row list: these are the
 * quantities those two documents ask a building to know, and every band they put
 * around them is a per-site value this template does not ship.
 *
 * **ONE TEMPLATE INSTANCE PER NODE** — per occupied zone, or on an air handling
 * unit's return. A floor's or a building's air quality index is a hierarchy
 * roll-up and not another instance of this template.
 *
 * **17 POINTS — 5 core + 9 extended + 1 manual + 2 DERIVED.** §6's 15 table rows
 * in the document's own order (`sortOrder` 0-14) and the two promoted codes
 * appended at 15 and 16.
 *
 * ---
 *
 * **THE FIRST STOCK ENTRY EVER FILED UNDER `environment`, AND THE ONLY ONE IN
 * THIS PACK** (ADR 0054 decision 2). Its code prefix is `environment-` while five
 * of its six PR 1 siblings are `facility-`, and it lives in `facility.ts`
 * regardless: **a pack is one DOCUMENT and a prefix is a DOMAIN, and the two are
 * different axes.** `environment` is the right domain because it is the one whose
 * vocabulary already holds this node's `temperature_c` and `humidity_pct`, which
 * is also why the seeded `BASELINE-ENVIRONMENT` template and the PHE gateway
 * screens keep working unchanged. Filing it under `facility` would have split
 * those two codes across two domains for no gain.
 *
 * **`ENVIRONMENT_CLASS_POINT_KEYS` IS A SECOND ARRAY UNDER ONE DOMAIN, and the
 * closed enum is why.** `CONTROL_ROOM_ENVIRONMENT_POINT_KEYS` backs
 * `controlRoomEnvironmentPointKeySchema`, a **closed `z.enum`** the control-room
 * screens consume; widening it to hold eleven pollutants would put rows on those
 * screens that no control room reports. So the new codes go in a second array
 * filed under the same domain — the `HVAC_CLASS_POINT_KEYS` precedent — and
 * `temperature_c` and `humidity_pct` stay exactly where they are.
 *
 * **FOUR REUSED CODES, REFERENCED AND NEVER REDECLARED** (ADR 0054 decision 3):
 *
 *  - `temperature_c` and `humidity_pct` from the control room, `core` here with
 *    `°C` and `%`. An air quality node that reports no temperature and no
 *    humidity can say whether the air is clean and not whether it is
 *    comfortable, which is half of what the section is for.
 *  - **`co_ppm` and `sensor_battery_pct` are filed under `facility`** — §5's
 *    parking level and §4's occupancy zone are their first occurrences — and are
 *    referenced here from an `environment` entry. **A domain line is not a
 *    vocabulary boundary**: first occurrence wins over the whole document.
 *
 * **`co_ppm` IS `extended` HERE AND `core` ON THE PARKING LEVEL — the pack's
 * dual-tier row** (ADR 0054 decision 4), the shape `effluent_cod_mgl` has on the
 * sewage plant and the effluent plant. A tier is per ENTRY: on a parking level
 * carbon monoxide IS the ventilation interlock and the level cannot work without
 * it, while here it is one pollutant among nine on a comfort sensor. The unit is
 * `ppm` on both, because a unit is NOT per entry — it is seeded write-once
 * through the seed's `COALESCE`.
 *
 * **`no2_ppb` HERE IS NOT §5's `no2_ppm`.** Two quantities at two ranges: an
 * indoor node's trace measurement in parts per billion and a basement's diesel
 * exhaust in parts per million. Deliberately not normalised into one code.
 * `co2_ppm` is likewise not the air handling unit's `return_air_co2_ppm` — a
 * zone node is not a duct sensor.
 *
 * **UNIT SPELLINGS ARE PERMANENT THE MOMENT THE SEED RUNS ONCE.** `µg/m³` is
 * **U+00B5 MICRO SIGN** with **U+00B3 SUPERSCRIPT THREE**, matching `E5.1`'s
 * `µS/cm`, and `CFU/m³` carries the same superscript. A client CSV spelling
 * `ug/m3` with an ASCII `u` gets a 400 from `onboarding-commit.service.ts`,
 * which compares the string exactly — correct, and worth saying out loud for
 * five rows a client will type by hand.
 *
 * ---
 *
 * **TWO DERIVED CODES PROMOTED, AND THEY ARE THE PACK'S ONLY TWO
 * `maxInputAgeSeconds` OVERRIDES.**
 *
 *  - `co2_above_outdoor_ppm` = `{co2_ppm} - {outdoor_co2_ppm}` — the ASHRAE 62.1
 *    quantity. The ventilation question is asked about the DIFFERENCE and not
 *    the absolute indoor reading: a site whose outdoor air is already high is
 *    not under-ventilated for having a high indoor number, and a site in clean
 *    air is under-ventilated well before its indoor reading looks alarming.
 *  - `pm25_indoor_outdoor_ratio` = `{pm25_ugm3} / {outdoor_pm25_ugm3}` —
 *    filtration effectiveness, and it is **dimensionless**: a null unit here
 *    against `""` in the vocabulary, the `cop` spelling (plan §12 ruling 7). A
 *    percent sign on it would be read as a percentage and it is not one — it is
 *    above one when the indoor air is dirtier than the outdoor air.
 *
 * **BOTH CARRY `maxInputAgeSeconds: 3600`, and nothing else in the pack does.**
 * §6 spells the outdoor rows *"site or API"*, and a weather service updates
 * hourly at best. At the 300 s default the formula would silently never fire,
 * which an operator reads as *"the feature is broken"* — the harder failure to
 * diagnose than a wrong number. This is `E5.1`'s `approach_c` precedent and
 * `E5.2`'s `oil_rise_over_ambient_c` one: a slow site input gets an age the site
 * can actually meet. `facility-classes-3.spec.ts` asserts it in both
 * directions — these two carry `3600` and **every other derived point in the
 * pack carries `null`** — because an override is a claim that an input is slow,
 * and it is wrong on a point fed by the asset's own controller.
 *
 * **A node with no outdoor reference divides by zero or subtracts nothing, and
 * that is handled rather than guarded**: `evaluate.ts` returns `non_finite` at a
 * zero denominator — no value, never a wrong one.
 *
 * **THREE DERIVED CODES ARE DEFERRED AND NAMED, never placeholdered** (ADR 0054
 * decision 6; ADR 0051 Amendment 6 decision 8):
 *
 *  - **Two METHODS the document only names.** `iaq_index` is an ISHRAE IEQ
 *    banding — a table indexed by pollutant and concentration range, and §6
 *    names the method without fixing the bands. `ventilation_adequacy_pct`
 *    measures against a ventilation rate that is per occupancy category and that
 *    the document does not define. Both would need a number picked here and
 *    shipped to every organization unread, which is exactly what ADR 0019
 *    Amendment 2 exists to stop.
 *  - **A time window** — `hours_out_of_band_day`. `bms-calc-v1` has arithmetic,
 *    parentheses and five functions and no clock and no memory, and the band is
 *    the site's as well.
 *
 * **NO `content.kpis`** (ADR 0054 decision 6): every ratio §6 names is either one
 * of the two points above or one of the three deferrals.
 *
 * ---
 *
 * **SIX ALARMS FROM SIX BULLETS — nothing dropped, nothing invented.**
 *
 * **EVERY ROW CARRIES A `skill`**, and after §1's lighting zone this is the only
 * entry in the pack where that is true. Four are `hvac`, because what answers an
 * air quality reading is ventilation and filtration; two are `controls`, because
 * a node that has stopped reporting or is running its battery down is a sensor
 * binding. **None of the pack's 16 no-skill rows is here**: an air quality
 * reading is a condition an engineer corrects, not a life-safety or security
 * event somebody attends.
 *
 * `co2_above_outdoor_high` **binds the derived point** — shipped behaviour, the
 * `recovery_low` shape — for the reason the formula exists at all.
 *
 * **`co_high` IS THE ONE ROW HERE THAT IS NOT ABOUT COMFORT.** Carbon monoxide
 * indoors is combustion ingress: a flue, a plant room, a loading bay or a
 * kitchen appliance venting into occupied space. The other three readings are
 * conditions to correct; this one is people to move, which is why it is
 * `critical` / `safety` while its neighbours are `warning` / `comfort`.
 *
 * **EVERY ALARM IS PAIR-ABSENT AND CARRIES A POPULATED `philosophy`** — no
 * `thresholdValue`, no `operator` (ADR 0019 Amendment 2, ADR 0054 decision 5,
 * B7). **The ISHRAE and ASHRAE bands are per site and none of them appears in a
 * row here**, in the message or inside the philosophy: a laboratory, an operating
 * theatre, a hotel lobby and an open-plan office are held to different numbers,
 * and a number shipped to every organization unread is a number somebody will
 * believe.
 *
 * ---
 *
 * **MAINTENANCE — 3 plans, PROVISIONAL** (ADR 0054 decision 8), derived from
 * sensor co-location practice and periodic microbial sampling, because the tag
 * list has no maintenance section. **None is `safetyCritical`, and that is
 * authored rather than omitted**: this is a SENSING node, nothing on it is a
 * barrier whose silent failure hurts somebody, and the `co_high` row it raises is
 * answered by moving people and finding the combustion source rather than by a
 * task. **No `condition_based` plan** either — a sensor is co-located and
 * re-spanned on a schedule, a battery is replaced on a round and a microbial
 * sample is taken periodically. The sampling round is the only thing in the
 * template that says how the `M` row's value arrives at all.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the site's
 * telemetry wiring — here the node's own object on its wireless or BACnet
 * gateway, and for the outdoor rows possibly a weather API the integrator mapped
 * — which the tag list does not know and the catalog must not guess.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `environment-iaq-node` **v1** (2026-09-04, `E5.3`): authored from
 *    `e5.3-derived-taglist-v1.md` §6, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const ENVIRONMENT_IAQ_NODE: StockAssetTemplateEntry = {
  code: "environment-iaq-node",
  name: "Indoor air quality node",
  assetType: "iaq_node",
  domain: "environment",
  description:
    "One indoor air quality node — per occupied zone, or on an air handling unit's return — " +
    "reporting the ISHRAE IEQ and ASHRAE 62.1 parameter set: air temperature and relative " +
    "humidity, carbon dioxide, fine and coarse particulate, total volatile organic compounds, " +
    "formaldehyde, carbon monoxide, ozone and nitrogen dioxide, an outdoor reference for " +
    "particulate and carbon dioxide taken from a site sensor or a weather service, the node's " +
    "own reporting state and battery, and a periodic laboratory microbial count entered by " +
    "hand. It is the first stock entry filed under the environment domain, which is the domain " +
    "whose vocabulary already holds its temperature and humidity keys. A floor's or a " +
    "building's air quality index is a hierarchy roll-up, not another instance of this " +
    "template. Authored from docs/e5.3-derived-taglist-v1.md §6 (PROVISIONAL — derived from " +
    "published practice, not client-confirmed). Tier C points are required and X optional; " +
    "alarm rows carry a meaning and no limit, because every ISHRAE and ASHRAE band is a per-site " +
    "value and a laboratory, an operating theatre and an open-plan office are held to different " +
    "ones. Two derived points are authored — carbon dioxide above the outdoor reference, and " +
    "indoor particulate over outdoor as a filtration ratio — and both carry a longer maximum " +
    "input age than anything else in this pack, because the outdoor reference is slow. Three of " +
    "the section's derived codes are deferred and named: two are banding methods the document " +
    "only names, and one is a time window.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "co2_above_outdoor_high",
        pointKey: "co2_above_outdoor_ppm",
        severity: "warning",
        category: "comfort",
        message:
          "Indoor carbon dioxide above the outdoor reference by more than the ventilation band — " +
          "the zone is under-ventilated for the people in it. The band is the site's, set per " +
          "space type against the ventilation rate that space was designed to.",
        philosophy: {
          cause:
            "Outside-air dampers closed or minimum-position set too low, a demand-controlled " +
            "ventilation loop reading an occupancy signal that is wrong, an air handling unit " +
            "running at reduced flow, a zone re-occupied at a higher density than it was " +
            "designed for, or a supply path throttled or blocked after a fit-out.",
          impact:
            "Occupants get drowsy and lose concentration well before anybody calls it stuffy, " +
            "and the complaint that eventually arrives is about the temperature rather than the " +
            "air. The difference is measured against outdoor precisely so that a site in already " +
            "poor outdoor air is not judged under-ventilated for it.",
          action:
            "Check the outside-air damper position and the minimum setting on the unit serving " +
            "this zone, then the occupancy signal the demand loop reads. If the zone's density " +
            "genuinely changed, this is a ventilation capacity finding for a report and not a " +
            "fault to clear.",
          skill: "hvac",
        },
      },
      {
        code: "pm25_high",
        pointKey: "pm25_ugm3",
        severity: "warning",
        category: "comfort",
        message:
          "Fine particulate high indoors — filtration or infiltration. The level is the site's; " +
          "the indoor-over-outdoor ratio on this node says which of the two it is.",
        philosophy: {
          cause:
            "Filters at the end of their life or bypassed by a poorly seated frame, outdoor air " +
            "brought in during a period of poor ambient quality, infiltration through an open " +
            "door or a leaky façade, or an indoor source — cooking, printing, construction or " +
            "sweeping.",
          impact:
            "Fine particulate reaches the lower airway and it is the parameter with the clearest " +
            "long-term health evidence behind it. A filtration problem affects everybody served " +
            "by that unit continuously, which is why the ratio matters more than the reading: a " +
            "high indoor level in bad outdoor air is a different job from a high one in clean " +
            "air.",
          action:
            "Read the indoor-over-outdoor ratio first. A ratio near or above one with the " +
            "outdoor air clean is filtration — check the filter condition and the frame seal. A " +
            "low ratio in bad outdoor air means the filters are working and the answer is to " +
            "reduce outside air until the ambient improves, which is a control decision rather " +
            "than a repair.",
          skill: "hvac",
        },
      },
      {
        code: "tvoc_high",
        pointKey: "tvoc_ugm3",
        severity: "warning",
        category: "comfort",
        message:
          "Total volatile organic compounds high — usually a source event rather than a system " +
          "failure. The level and the period it must persist for are the site's.",
        philosophy: {
          cause:
            "Cleaning products used in strength or in an unventilated period, new furniture, " +
            "carpet, paint or adhesive off-gassing after a fit-out, a printing or laboratory " +
            "activity in or near the zone, or a solvent store venting into occupied space.",
          impact:
            "Occupants report headache and irritation, and a fit-out that off-gasses for weeks " +
            "produces a run of complaints nobody connects to the works. The sensor is " +
            "isobutylene-equivalent and reports a mixture, so it says something is present " +
            "rather than what.",
          action:
            "Ventilate the zone and find the source before adjusting anything on the sensor — " +
            "this row is almost always right and almost never a system fault. A reading that " +
            "recurs at the same hour each day is an activity, and one that decays over weeks is " +
            "a fit-out.",
          skill: "hvac",
        },
      },
      {
        code: "co_high",
        pointKey: "co_ppm",
        severity: "critical",
        category: "safety",
        message:
          "Carbon monoxide detected indoors — combustion ingress. The level is the site's, and " +
          "this is the one row on this node that is not about comfort.",
        philosophy: {
          cause:
            "A flue leaking into occupied space, a plant room or boiler house sharing air with " +
            "the zone, exhaust drawn in from a loading bay or a car park through an outside-air " +
            "intake, or a gas appliance in a kitchen venting badly.",
          impact:
            "Carbon monoxide is colourless and odourless and it takes people down before they " +
            "know it is there. Every other reading on this node is a condition an engineer " +
            "corrects over days; this one is people to move now.",
          action:
            "Move people out of the zone and ventilate it, then find the combustion source — " +
            "that order. Check the flues and the outside-air intake's surroundings before " +
            "suspecting the sensor, and do not return the zone to use on the strength of a " +
            "falling reading alone.",
          skill: "hvac",
        },
      },
      {
        code: "sensor_offline",
        pointKey: "sensor_online",
        severity: "warning",
        category: "operations",
        message:
          "Node not reporting. Every reading on this zone is now stale and holds its last value.",
        philosophy: {
          cause:
            "A flat battery, a wireless node out of range after the space was re-partitioned, a " +
            "gateway that stopped polling, or a node removed during other work and not put back.",
          impact:
            "The zone's air quality is unknown, and a stale reading looks exactly like a steady " +
            "one on a trend. Anything driven from this node — a demand-controlled ventilation " +
            "loop, a report, the two derived points — is working from a value that stopped " +
            "moving.",
          action:
            "Check the battery row's last value before making a visit; a node that reported a " +
            "low battery and then went quiet needs a cell and not an investigation. If the " +
            "battery was healthy, look at the gateway and at what changed in the space.",
          skill: "controls",
        },
      },
      {
        code: "sensor_battery_low",
        pointKey: "sensor_battery_pct",
        severity: "info",
        category: "operations",
        message:
          "Node battery low. The level that means low is the node's own and is set per site, " +
          "because the reserve a cell holds depends on how often the node reports.",
        philosophy: {
          cause:
            "A cell at the end of its service life, a node reporting more often than it was " +
            "commissioned to, or a cold location that shortens the cell's useful output.",
          impact:
            "Nothing yet, which is why this row is informational. What follows is the " +
            "sensor_offline row and the zone's readings going stale — this is the warning that " +
            "precedes it, and it is the reason a battery round is cheaper than a call-out.",
          action:
            "Add the node to the next battery replacement round rather than visiting for it. " +
            "Nodes commissioned together run down together, so replace the round.",
          skill: "controls",
        },
      },
    ],
    maintenance: [
      {
        title: "Sensor co-location calibration",
        category: "calibration",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 60,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Co-locate a reference instrument beside the node and compare co2_ppm and pm25_ugm3 " +
          "over a working day, then re-span or replace the affected element. Low-cost optical " +
          "particulate and carbon dioxide elements drift over their life and they drift " +
          "quietly — the readings stay plausible while they move — so this is the task that " +
          "keeps both derived points and every alarm on this node honest. Check the outdoor " +
          "reference source at the same time: a node calibrated against a stale weather feed " +
          "computes a confident wrong difference.",
      },
      {
        title: "Battery replacement",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 15,
        priority: "low",
        safetyCritical: false,
        triggerSummary:
          "Replace the cell in the wireless node and confirm it comes back online with a " +
          "healthy battery reading. Nodes commissioned together run down together, so this is a " +
          "round across the floor rather than a visit to one sensor, and it is what stops the " +
          "sensor_offline row arriving before anybody planned for it.",
      },
      {
        title: "Microbial sampling round",
        category: "inspection_round",
        generationMode: "calendar",
        intervalDays: 182,
        estimatedMinutes: 60,
        priority: "low",
        safetyCritical: false,
        triggerSummary:
          "Take an air sample in the zone, send it for a total microbial count and record the " +
          "laboratory result against microbial_count_cfu. That row is manual: it never gets a " +
          "telemetry mapping and is always skipped at instantiation, so this round is the only " +
          "thing in the template that says how the value arrives. Note the season and the " +
          "recent water or damp history with the result — a count read without them says very " +
          "little.",
      },
    ],
  },
  points: [
    // Reused from CONTROL_ROOM_ENVIRONMENT_POINT_KEYS and referenced, never
    // redeclared: that array backs a closed z.enum the control-room screens
    // consume, and ENVIRONMENT_CLASS_POINT_KEYS is a SECOND array under the same
    // domain rather than a widening of it (ADR 0054 decision 3).
    { ...MEASURED, pointKey: "temperature_c", label: "Air temperature", unit: "°C", required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "humidity_pct", label: "Relative humidity", unit: "%", required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "co2_ppm", label: "CO₂ (ventilation adequacy)", unit: "ppm", required: true, sortOrder: 2, meta: CORE },
    { ...MEASURED, pointKey: "pm25_ugm3", label: "PM2.5", unit: "µg/m³", required: true, sortOrder: 3, meta: CORE },
    { ...MEASURED, pointKey: "pm10_ugm3", label: "PM10", unit: "µg/m³", required: false, sortOrder: 4, meta: EXTENDED },
    { ...MEASURED, pointKey: "tvoc_ugm3", label: "TVOC (isobutylene-equivalent)", unit: "µg/m³", required: false, sortOrder: 5, meta: EXTENDED },
    { ...MEASURED, pointKey: "ch2o_ugm3", label: "Formaldehyde", unit: "µg/m³", required: false, sortOrder: 6, meta: EXTENDED },
    // The pack's DUAL-TIER row, extended here and core on facility-parking-level
    // (ADR 0054 decision 4). Declared under `facility`, because §5 is its first
    // occurrence — a domain line is not a vocabulary boundary. The unit is ppm
    // on both entries, because a unit is not per entry.
    { ...MEASURED, pointKey: "co_ppm", label: "CO", unit: "ppm", required: false, sortOrder: 7, meta: EXTENDED },
    { ...MEASURED, pointKey: "o3_ppb", label: "Ozone", unit: "ppb", required: false, sortOrder: 8, meta: EXTENDED },
    // NOT §5's no2_ppm: an indoor trace measurement in ppb and a basement's
    // diesel exhaust in ppm are two quantities at two ranges.
    { ...MEASURED, pointKey: "no2_ppb", label: "NO₂", unit: "ppb", required: false, sortOrder: 9, meta: EXTENDED },
    { ...MEASURED, pointKey: "outdoor_pm25_ugm3", label: "Outdoor reference PM2.5 (site or API)", unit: "µg/m³", required: false, sortOrder: 10, meta: EXTENDED },
    { ...MEASURED, pointKey: "outdoor_co2_ppm", label: "Outdoor reference CO₂", unit: "ppm", required: false, sortOrder: 11, meta: EXTENDED },
    // Referenced from `facility` — §4's occupancy zone declares it.
    { ...MEASURED, pointKey: "sensor_battery_pct", label: "Battery (wireless nodes)", unit: "%", required: false, sortOrder: 12, meta: EXTENDED },
    { ...MEASURED, pointKey: "sensor_online", label: "Node reporting", unit: null, required: true, sortOrder: 13, meta: CORE },
    // The entry's one M row: a laboratory result on a periodic sample, entered
    // through F1.8 and never mapped from a data key.
    { ...MEASURED, pointKey: "microbial_count_cfu", label: "Total microbial count", unit: "CFU/m³", required: false, sortOrder: 14, meta: MANUAL },
    // Derived, appended after the table rows. No meta.tier: the C/X/M column
    // says what the node HAS FITTED, and a computed point is fitted by nobody.
    // Both carry maxInputAgeSeconds 3600 and NOTHING ELSE IN THE PACK DOES: §6
    // spells the outdoor rows "site or API", and at the 300 s default a formula
    // fed by an hourly weather feed would silently never fire. A node with no
    // outdoor reference divides by zero and evaluate.ts returns non_finite,
    // which is why neither row is clamped.
    {
      ...derived("{co2_ppm} - {outdoor_co2_ppm}", { maxInputAgeSeconds: 3600 }),
      pointKey: "co2_above_outdoor_ppm",
      label: "CO₂ above the outdoor reference",
      unit: "ppm",
      required: false,
      sortOrder: 15,
    },
    // Dimensionless — a null unit against "" in the vocabulary, the `cop`
    // spelling. A percent sign would be read as a percentage and it is not one:
    // the value is above one when the indoor air is dirtier than the outdoor.
    {
      ...derived("{pm25_ugm3} / {outdoor_pm25_ugm3}", { maxInputAgeSeconds: 3600 }),
      pointKey: "pm25_indoor_outdoor_ratio",
      label: "Indoor over outdoor PM2.5 (filtration effectiveness)",
      unit: null,
      required: false,
      sortOrder: 16,
    },
  ],
};
