import { CORE, EXTENDED, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The facility pack's BAS gateway / controller — `E5.3`, ADR 0054 decisions 1-9,
 * ADR 0052 decisions 1, 2 and 6, ADR 0019 Amendment 2.
 *
 * **SOURCE.** `docs/e5.3-derived-taglist-v1.md` §7 — *"BAS gateway / controller
 * health — the device layer"*. PROVISIONAL: derived from published practice,
 * not client-confirmed.
 *
 * **THE ONE CLASS IN THIS PACK WHOSE SUBJECT IS THE PLATFORM'S OWN PLUMBING.**
 * §7 says it plainly: *"not a building subsystem but the thing every facility
 * point depends on"*. A lighting zone that goes quiet is a lighting fault; a
 * gateway that goes quiet takes the lighting zone, the fire panel, the access
 * controller and every other point behind it dark at once, and the screens that
 * read them keep rendering the last value they got. That is why `device_offline`
 * is `critical` on an entry with no moving part on it, and it is the only row in
 * the pack whose failure is about OTHER assets' data.
 *
 * **ONE TEMPLATE INSTANCE PER GATEWAY OR CONTROLLER** — per physical device
 * with its own address, not per panel and not per building. A site's overall
 * integration health is a hierarchy roll-up across these instances.
 *
 * **13 POINTS — 2 core + 11 extended + 0 manual + 0 derived.** §7's 13 table
 * rows in the document's own order (`sortOrder` 0-12), and nothing appended:
 * this entry promotes no derived code at all (below).
 *
 * ---
 *
 * **THE TWO CORE ROWS ARE THE TWO WAYS A GATEWAY FAILS, and they are different
 * failures.** `device_online` is reachability and `last_seen_age_s` is
 * freshness. A gateway that answers a ping while its points stop updating looks
 * HEALTHIER on a dashboard than one that is plainly offline — every trend goes
 * flat rather than empty, and a flat trend reads as a steady process. §7 calls
 * that bullet *"the one that fools dashboards"*, so the age row is `core` beside
 * the reachable flag and not below it. Everything else is `extended` because it
 * depends on what the particular device exposes: `cpu_pct` and `memory_pct` come
 * from a Linux-class gateway rather than a field controller, `points_stale_count`
 * needs a gateway that counts its own deadbands, and `ups_on_battery` needs a
 * UPS to be fitted at all.
 *
 * **ONE REUSED CODE, REFERENCED AND NEVER REDECLARED** (ADR 0054 decision 3):
 * `leak_state` at row 12, from `CONTROL_ROOM_ENVIRONMENT_POINT_KEYS` — the
 * closed `z.enum` the control-room screens consume, which this pack does not
 * widen. It is `extended` here: water detection under a panel-room floor void is
 * fitted in some rooms and not others.
 *
 * **`door_open_state` IS NOT §3's `door_state`.** This row is the gateway's own
 * enclosure door — a tamper and a dust question about this device. §3's row is
 * the controlled door of an access-control point. Two devices, two questions,
 * and the prefix says which one reported it (the near-miss list in
 * `packages/shared/src/facility-point-keys.ts`). `ups_on_battery` sits beside
 * `on_battery` for the same reason: this is the CONTROLLER's supply, reported by
 * the controller, not an electrical UPS asset's own point.
 *
 * **THE PHE GATEWAY IS THIS CLASS'S PRIOR ART IN THIS REPOSITORY.** §7 names it:
 * the real-ingestion pilot's gateway already reports its own health under the
 * `environment` domain (`network_strength`, `controller_power_status`, and the
 * three that have since left). Those codes stay exactly where they are and are
 * NOT reused here — they are one integrator's gateway's own spellings on a
 * shipped pilot, and this template is the generic class. A site running that
 * gateway maps what it has; nothing about this entry disturbs the pilot.
 *
 * **SEVEN OF THE THIRTEEN ROWS CARRY A NULL UNIT**, the most of any entry in the
 * pack: four `0/1` rows, two `count` rows and one `text` row. §4.4 spells every
 * one of them `""` in the vocabulary. `firmware_version` is worth naming twice —
 * it is an attribute-as-point, a STRING carried on a template point, and a unit
 * on a string is meaningless rather than merely absent.
 *
 * ---
 *
 * **NO DERIVED POINT IS AUTHORED, AND ALL THREE OF §7's DERIVED CODES ARE
 * DEFERRED AND NAMED** (ADR 0054 decision 6; ADR 0051 Amendment 6 decision 8):
 *
 *  - **`data_quality_pct` — the SOW page-10 footer's own number**, *"Data
 *    Quality 98.6% Good"*, and §7 says out loud that the number comes from this
 *    class. **ADR 0054 decision 6 rules it to the `F3.x` estate surface and not
 *    to a template point**, and the reasoning is the shape of the quantity
 *    rather than the difficulty of computing it: good samples over expected
 *    samples is measured over the points BEHIND a gateway — points that belong
 *    to other assets, on other templates, at their own scan rates. A
 *    `bms-calc-v1` formula on this entry may reference only measured points this
 *    entry declares, so the honest per-gateway version does not exist here at
 *    all; a version built from `points_stale_count` alone would be a second,
 *    quieter answer to the estate's question and would disagree with it. The
 *    footer's number is a surface, and this class is where its INPUTS live.
 *  - **`uptime_pct`** — reachable time over elapsed time, an hours-in-state
 *    window.
 *  - **`mean_latency_s`** — a mean over a window. `last_seen_age_s` is the
 *    instantaneous row the `stale_data` alarm binds instead.
 *
 * `bms-calc-v1` has arithmetic, parentheses and five functions, and no clock and
 * no memory, so the last two are not expressible at all. **NO `content.kpis`**
 * (ADR 0054 decision 6): every ratio §7 names is one of the three above.
 *
 * ---
 *
 * **SEVEN ALARMS FROM SEVEN BULLETS — nothing dropped, nothing invented.**
 *
 * **EVERY ROW CARRIES A `skill`**, and the split is by what the responder
 * actually does. Five are `controls`: an unreachable gateway, one that has
 * stopped updating, protocol errors accumulating, a drifted clock and an open
 * panel door are all a controls engineer's work at the panel. Two are
 * `electrical` — `enclosure_temp_high` and `supply_voltage_low` — because a hot
 * enclosure and a sagging supply are the panel's cooling and its power, which is
 * the electrical trade's work rather than the integrator's. **None of the pack's
 * 16 no-skill rows is here**: a gateway reports nothing about a building's USE
 * and attends no life-safety or security event, so no row on it is waiting for a
 * trade that `bms.alarm_skills` has not got.
 *
 * **SIX DECLARED ROWS ARE BOUND BY NO ALARM, and each has its own reason.** §7
 * raises seven bullets over thirteen rows and §12 ruling 6 forbids inventing an
 * alarm for a row the document raises none for. `points_stale_count`, `cpu_pct`
 * and `memory_pct` are capacity and housekeeping trends — a chart over a month
 * reads them better than a pager does, and `stale_data` already alarms the
 * consequence the stale count describes. `ups_on_battery` is the electrical
 * system's own alarm and this row is the gateway REPORTING it; the UPS battery
 * plan names the row instead. `firmware_version` is a string with nothing to
 * compare it against without a target version, which is fleet-management state.
 * `leak_state` is the reused row §7 declares and raises no bullet for: the
 * room's own leak detection answers water under a floor void, and a second row
 * here would page a controls engineer for a plumbing fault.
 *
 * **EVERY ALARM IS PAIR-ABSENT AND CARRIES A POPULATED `philosophy`** — no
 * `thresholdValue`, no `operator` (ADR 0019 Amendment 2, ADR 0054 decision 5,
 * B7).
 *
 * **NO REGULATOR SETS ANY NUMBER ON THIS ENTRY, which is why
 * `assertNoLimitNumbers` is not called on it and why no row carries a digit
 * anyway.** The other six entries in this pack each answer to an authority —
 * NFPA 72 and IS 2189 on the fire panel, an occupancy licence on the zone and
 * the parking level, ISHRAE and ASHRAE on the air quality node — and `E5.3` §13
 * item 7 split the regime sentence per authority so that a failure cites the
 * right document. Here there is no authority at all: an enclosure temperature
 * limit is the controller's datasheet range, a supply band is the power supply's
 * specification, an acceptable protocol error rate is the integrator's at
 * commissioning and a tolerable clock drift is the site's. The rows therefore
 * carry the meaning and no number, in the message and inside the philosophy
 * both, and the class spec asserts that directly rather than through a helper
 * that would have to print a standard that says nothing. **The one digit on this
 * entry is `(24 V DC)` in the supply row's LABEL** — the tag list's own
 * parenthesis, a nominal rating and not a limit, kept because plan §5's label
 * convention keeps every parenthesis that is part of the measurement's meaning.
 *
 * ---
 *
 * **MAINTENANCE — 3 plans, PROVISIONAL** (ADR 0054 decision 8), derived from
 * OEM practice and from standby-battery test practice, because the tag list has
 * no maintenance section. **None is `safetyCritical`, and that is authored
 * rather than omitted**: this device OBSERVES the fire panel, the lift and the
 * access controller and it interlocks none of them, so a gateway that fails
 * leaves an estate blind and not an estate that is unsafe. **No `condition_based`
 * plan** either — firmware and backups are checked on a schedule, a battery is
 * tested on one and an enclosure is cleaned on one; none of the three is
 * generated by a reading, and the readings this entry does carry raise an alarm
 * somebody answers now rather than a work order raised later. Two of the three
 * plans exist partly to say what is DONE with a row no alarm binds
 * (`firmware_version`, `ups_on_battery`), which is the only place those rows are
 * mentioned in the template at all.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: a gateway's own health
 * objects are the integrator's naming on the very device this template
 * describes, which the tag list does not know and the catalog must not guess.
 *
 * **THIS ENTRY CLOSES PR 1** — seven classes, three domains, one document and
 * one index. PR 2 adds the lift and the escalator under `mechanical`.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `facility-bas-gateway` **v1** (2026-09-04, `E5.3`): authored from
 *    `e5.3-derived-taglist-v1.md` §7, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const FACILITY_BAS_GATEWAY: StockAssetTemplateEntry = {
  code: "facility-bas-gateway",
  name: "BAS gateway / controller",
  assetType: "bas_gateway",
  domain: "facility",
  description:
    "One building automation gateway or controller — the device layer every other facility " +
    "point arrives through, modelled per physical device rather than per panel or per building. " +
    "It reports whether it is reachable and how long ago its last good message arrived, the " +
    "protocol errors and stale points it counts, its processor and memory load, its enclosure " +
    "temperature, its supply voltage and whether its uninterruptible supply is on battery, its " +
    "panel door and a leak under the panel-room floor, its clock drift against the server and " +
    "its firmware string. Authored from docs/e5.3-derived-taglist-v1.md §7 (PROVISIONAL — " +
    "derived from published practice, not client-confirmed). Tier C points are required and X " +
    "optional; alarm rows carry a meaning and no limit, because no regulator sets a number on a " +
    "gateway — an enclosure range is the controller's datasheet, a supply band is the power " +
    "supply's and an acceptable error rate is the integrator's at commissioning. No derived " +
    "point is authored: all three of the section's derived codes are deferred and named, and " +
    "the data quality percentage the client's own dashboard footer shows is an estate-wide " +
    "surface computed over the points behind a gateway, not a point on the gateway itself.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "device_offline",
        pointKey: "device_online",
        severity: "critical",
        category: "operations",
        message:
          "Gateway unreachable. Every point behind this device is dark, and the screens that " +
          "read them are showing the last value that arrived.",
        philosophy: {
          cause:
            "Power lost at the panel, a network switch or link down, an address or firewall " +
            "change made during other work, a failed power supply, or the device itself hung " +
            "and needing a restart.",
          impact:
            "This is the one alarm in the pack that is about OTHER assets. Nothing behind this " +
            "gateway can report — not the lighting zones, not the panel it watches, not the " +
            "meters — so alarms that should be raising do not raise, and the last values keep " +
            "rendering as though they were current. An estate does not look broken when a " +
            "gateway drops; it looks quiet.",
          action:
            "Check power at the panel and the network link before suspecting the device. If the " +
            "link is healthy, restart the gateway and record what returns and what does not: a " +
            "device that comes back with only some of its points is a mapping or a downstream " +
            "bus problem, not a gateway problem.",
          skill: "controls",
        },
      },
      {
        code: "stale_data",
        pointKey: "last_seen_age_s",
        severity: "warning",
        category: "operations",
        message:
          "Gateway reachable but not updating. Its points are holding their last values, and " +
          "the age that counts as stale is the site's, set against how often this device is " +
          "polled.",
        philosophy: {
          cause:
            "A polling service stopped on the device, a downstream bus fault that leaves the " +
            "gateway healthy while its field devices are silent, a point list changed and not " +
            "re-commissioned, or a clock or licence condition that stopped the publisher " +
            "without stopping the device.",
          impact:
            "The dangerous one. A gateway that answers while its data stands still looks " +
            "healthier than one that is plainly offline: every trend goes flat instead of " +
            "empty, and a flat trend reads as a steady process. Decisions get made on values " +
            "that stopped moving, and threshold alarms below this device cannot fire because " +
            "nothing new arrives to compare.",
          action:
            "Compare the age row against the polling interval this device was commissioned " +
            "with, then look downstream before looking at the gateway: a healthy gateway with " +
            "silent field devices is a bus, a power or a device-address fault. Restart the " +
            "publishing service last, because it hides the evidence.",
          skill: "controls",
        },
      },
      {
        code: "comms_error_rate_high",
        pointKey: "comms_error_count",
        severity: "warning",
        category: "operations",
        message:
          "Protocol errors accumulating in the interval. The count that matters is the site's — " +
          "it depends on the bus, its length and how many devices share it.",
        philosophy: {
          cause:
            "A bus at its limit for length or device count, a missing or duplicated " +
            "termination, a marginal or corroded terminal, electrical noise from a drive or a " +
            "contactor sharing the route, a duplicated device address, or a field device " +
            "answering slowly enough to time out.",
          impact:
            "Errors are retried, so nothing looks wrong until the retries stop fitting inside " +
            "the poll cycle — then points go stale one at a time and the fault presents as a " +
            "handful of unrelated dead readings rather than as a bus problem. A rising count is " +
            "the early evidence, which is why it is a row and not only a log line.",
          action:
            "Read the count as a rate against the interval rather than as a total. Check " +
            "termination and screen continuity, then look for a drive or a contactor installed " +
            "near the bus since commissioning. Isolate half the segment to find the device that " +
            "carries the errors — the count is per gateway and does not name the offender.",
          skill: "controls",
        },
      },
      {
        code: "enclosure_temp_high",
        pointKey: "enclosure_temp_c",
        severity: "warning",
        category: "operations",
        message:
          "Panel enclosure hot. The limit is the controller's own operating range from its " +
          "datasheet and the site sets it here.",
        philosophy: {
          cause:
            "A blocked or missing filter, a failed panel fan, a panel cooler out of gas, the " +
            "plant room's own ventilation failing, or equipment added into an enclosure that " +
            "was sized without it.",
          impact:
            "Electronics do not fail politely at temperature — they behave oddly first. Comms " +
            "errors rise, the clock drifts, a power supply derates and the device restarts " +
            "without an obvious cause, which is a fault chased at the wrong layer for weeks. " +
            "Sustained heat also shortens the life of every capacitor in the panel.",
          action:
            "Check the filter and the fan first, then whether the room's own ventilation is " +
            "running. Do not open the door as a fix: an open panel cools by drawing dust into " +
            "the equipment and raises the door row on this entry.",
          skill: "electrical",
        },
      },
      {
        code: "supply_voltage_low",
        pointKey: "supply_voltage_v",
        severity: "warning",
        category: "operations",
        message:
          "Controller supply voltage low. The band is the power supply's own specification and " +
          "is set per site.",
        philosophy: {
          cause:
            "A power supply ageing or loaded beyond its rating, devices added onto a supply " +
            "sized for the original list, a long field run with volt drop under load, a loose " +
            "or corroded terminal, or a shared supply feeding a field device that has started " +
            "drawing more than it should.",
          impact:
            "A low supply is the cause behind faults that look like everything else: comms " +
            "errors, unexplained restarts, field devices dropping in and out. It rarely fails " +
            "outright, so it is diagnosed late and usually after the gateway has been replaced " +
            "for no reason.",
          action:
            "Measure at the controller terminals under load rather than at the supply's own " +
            "output, then add up what the supply is actually feeding against its rating. Check " +
            "for a shorted or wet field device before condemning the supply — a device drawing " +
            "hard pulls the whole rail down.",
          skill: "electrical",
        },
      },
      {
        code: "clock_drift",
        pointKey: "rtc_drift_s",
        severity: "warning",
        category: "operations",
        message:
          "Gateway clock has drifted from the server. The drift that matters is the site's, and " +
          "it is smaller than most people expect.",
        philosophy: {
          cause:
            "A time source unreachable or never configured, a dead real-time-clock battery, a " +
            "device restored from a backup with an old time, or a daylight or time-zone setting " +
            "that disagrees with the server.",
          impact:
            "Every timestamp this gateway produces is wrong by the drift, which makes an event " +
            "sequence unreadable: an alarm appears to precede its own cause, a trend gets a step " +
            "in it, and an interval counter attributes its consumption to the wrong period. " +
            "Nothing looks broken — the data is simply not what it says it is, which is worse.",
          action:
            "Set the time source rather than the clock; a clock set by hand drifts back. Replace " +
            "the real-time-clock battery if the device loses time across a power cycle, and " +
            "check the time zone and the daylight rule against the server's before assuming a " +
            "hardware fault.",
          skill: "controls",
        },
      },
      {
        code: "panel_door_open",
        pointKey: "door_open_state",
        severity: "info",
        category: "operations",
        message:
          "Panel door open. Informational — it is normal during work and it is the standing " +
          "condition that matters.",
        philosophy: {
          cause:
            "Maintenance in progress, a door left open after work, a latch or a lock that no " +
            "longer holds, or access to a panel by somebody who should not have it.",
          impact:
            "An open enclosure loses its cooling path and takes in dust, which is the slow " +
            "version of the enclosure temperature row. It also removes the physical barrier in " +
            "front of live terminals and of the controller's own configuration. None of that " +
            "matters for the hour an engineer is working; all of it matters when the door " +
            "stands open for a week.",
          action:
            "Close it and check the latch. If the row is standing open, find out who was last " +
            "at the panel before treating it as a sensor fault, and confirm the door switch " +
            "actually changes state when the door is closed.",
          skill: "controls",
        },
      },
    ],
    maintenance: [
      {
        title: "Firmware, backup and clock check",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 180,
        estimatedMinutes: 45,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Record the firmware_version this device is running, take a configuration and point-list " +
          "backup off it, and confirm its time source is set and its rtc_drift_s is inside the " +
          "site's tolerance. Both rows are reported and alarmed by nothing — a version string has " +
          "nothing to compare against without a target, and this task is where that comparison is " +
          "made by a person. Keep the backup somewhere that survives the panel: a gateway is " +
          "replaced in an hour and re-commissioned from nothing in a week.",
      },
      {
        title: "Controller UPS battery test",
        category: "preventive",
        generationMode: "calendar",
        intervalDays: 180,
        estimatedMinutes: 30,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Drop the mains to the controller's uninterruptible supply, confirm ups_on_battery goes " +
          "true and the gateway rides through, and check the reserve against the time the site " +
          "expects. A standby battery fails invisibly — it holds its float voltage and gives " +
          "nothing under load — so it is only tested by being used. This row is bound by no alarm " +
          "because the mains failure behind it is the electrical system's own; this plan is where " +
          "the battery itself is proven.",
      },
      {
        title: "Enclosure clean, filter and terminal check",
        category: "inspection_round",
        generationMode: "calendar",
        intervalDays: 90,
        estimatedMinutes: 30,
        priority: "low",
        safetyCritical: false,
        triggerSummary:
          "Clean or replace the panel filter, confirm the panel fan runs, tighten the field and " +
          "supply terminals and look for dust, damp and rodent damage in the enclosure. Read " +
          "enclosure_temp_c before and after: a filter is the cheapest thing in the panel and it " +
          "is what keeps that reading in range, and a warm enclosure is the quiet cause behind " +
          "comms errors, clock drift and restarts nobody can explain.",
      },
    ],
  },
  points: [
    // §7's 13 rows in the document's own order. The two C rows are the two ways
    // a gateway fails and they are different failures: reachability, and
    // freshness — a device that answers while its points stand still looks
    // healthier on a dashboard than one that is plainly offline.
    { ...MEASURED, pointKey: "device_online", label: "Controller / gateway reachable", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "last_seen_age_s", label: "Seconds since last good message", unit: "s", required: true, sortOrder: 1, meta: CORE },
    // Interval counter. The editorial remark is dropped from the label per plan
    // §5's convention; the alarm reads it as a rate against the interval.
    { ...MEASURED, pointKey: "comms_error_count", label: "Protocol errors", unit: null, required: false, sortOrder: 2, meta: EXTENDED },
    { ...MEASURED, pointKey: "points_stale_count", label: "Points not updated within their deadband", unit: null, required: false, sortOrder: 3, meta: EXTENDED },
    { ...MEASURED, pointKey: "cpu_pct", label: "Controller CPU load", unit: "%", required: false, sortOrder: 4, meta: EXTENDED },
    { ...MEASURED, pointKey: "memory_pct", label: "Controller memory use", unit: "%", required: false, sortOrder: 5, meta: EXTENDED },
    { ...MEASURED, pointKey: "enclosure_temp_c", label: "Panel / enclosure temperature", unit: "°C", required: false, sortOrder: 6, meta: EXTENDED },
    // The label keeps the tag list's own parenthesis: it is the nominal supply
    // rating and part of the measurement's meaning, not a limit. No alarm string
    // on this entry carries a digit.
    { ...MEASURED, pointKey: "supply_voltage_v", label: "Controller supply voltage (24 V DC)", unit: "V", required: false, sortOrder: 7, meta: EXTENDED },
    { ...MEASURED, pointKey: "ups_on_battery", label: "Controller UPS on battery", unit: null, required: false, sortOrder: 8, meta: EXTENDED },
    // The PANEL's own door — not §3's door_state, which is the controlled door
    // of an access point. Two devices, two questions.
    { ...MEASURED, pointKey: "door_open_state", label: "Panel door open", unit: null, required: false, sortOrder: 9, meta: EXTENDED },
    { ...MEASURED, pointKey: "rtc_drift_s", label: "Clock drift vs server", unit: "s", required: false, sortOrder: 10, meta: EXTENDED },
    // An attribute-as-point: a STRING on a template point, so the unit is null
    // rather than absent by oversight.
    { ...MEASURED, pointKey: "firmware_version", label: "Firmware string", unit: null, required: false, sortOrder: 11, meta: EXTENDED },
    // Reused from CONTROL_ROOM_ENVIRONMENT_POINT_KEYS and referenced, never
    // redeclared: that array backs a closed z.enum the control-room screens
    // consume (ADR 0054 decision 3). No alarm binds it — the room's own leak
    // detection answers water under a floor void, and §7 raises no bullet here.
    { ...MEASURED, pointKey: "leak_state", label: "Water leak under floor / in room", unit: null, required: false, sortOrder: 12, meta: EXTENDED },
  ],
};
