import { CORE, EXTENDED, MANUAL, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The facility pack's fire-alarm-panel class — `E5.3`, ADR 0054 decisions 1-9,
 * ADR 0052 decisions 1, 2 and 6, ADR 0019 Amendment 2.
 *
 * **SOURCE.** `docs/e5.3-derived-taglist-v1.md` §2 — *"Fire alarm panel — FACP
 * zone / loop (addressable or conventional)"*. PROVISIONAL: derived from
 * published practice, not client-confirmed. The section's basis line is
 * explicit: **the state vocabulary is NFPA 72 / IS 2189** — alarm, fault,
 * trouble, supervisory, pre-alarm, isolate/disable — so the twenty-four rows
 * below are the states an addressable or conventional panel actually publishes
 * to a gateway, under the names the standards give them.
 *
 * **THE BMS OBSERVES ONLY. THERE IS NO RESET, NO SILENCE AND NO ISOLATE
 * COMMAND**, anywhere in this entry, and that is a scope fence rather than an
 * omission (ADR 0054; §2's own instruction). Those three actions belong to the
 * person standing at the panel who can see the zone plan and the building. A
 * template carries no command surface today, so an INSTRUCTION is all that could
 * ship — and an instruction to silence a fire panel from a monitoring screen is
 * one somebody will follow the day a command surface exists.
 * `facility-classes.spec.ts` scans every alarm message, every `philosophy`
 * string and every `triggerSummary` for those imperatives and fails on them.
 * `sounder_silenced` is still a declared row, because the panel REPORTING that
 * somebody silenced it at the panel is exactly the observation this entry is
 * for.
 *
 * **24 POINTS — 8 core + 15 extended + 1 manual + 0 DERIVED.** §2's 24 table
 * rows in the document's own order (`sortOrder` 0-23) and nothing appended.
 *
 * **ONE TEMPLATE PER PANEL.** §2 says zones and loops are child points or child
 * assets *"depending on the gateway's object model"*, and this entry authors the
 * **panel-level** roll-ups only: `zone_alarm_state`, `zone_fault_state` and
 * `zone_isolated_state` are the per-zone states as the panel presents them. A
 * child-asset-per-zone model is a v2 shape behind `F2.10`'s hierarchy work, and
 * a site that wants it today builds it with an asset group.
 *
 * **`smoke_state` IS A REUSED CODE** (ADR 0054 decision 3): the control room's,
 * referenced here and redeclared nowhere. Its unit is the empty string the
 * vocabulary already seeds and is write-once through the seed's `COALESCE`, so
 * this row carries `null` and defers to the catalog rather than overriding it on
 * every organization that imports the entry.
 *
 * **`panel_comms_ok` IS DECLARED HERE, AND IT IS NOT §3's
 * `controller_comms_ok`.** The two are different codes on different devices and
 * are not to be normalised into one: this row is the link between the gateway
 * and the FIRE panel, and the alarm that binds it is the only `critical` comms
 * row in the pack.
 *
 * **`weekly_test_done` IS THE `M` ROW.** The weekly test is a signature in a
 * logbook, not a telemetry point: it arrives through `F1.8` manual entry and is
 * never mapped from a data key. An `M` row carries a null pattern **forever**,
 * so it is always in `skippedPoints` and never gets an `asset_points` row — and
 * promoting it to `C` would make every instantiation fail.
 *
 * **FOUR DERIVED CODES ARE DEFERRED AND NAMED, and one of them is the pack's NEW
 * deferral class** (ADR 0054 decision 6; plan §12 ruling 5):
 *
 *  - **A SUBSYSTEM STATE ROLL-UP — the new class, and the first deferral in this
 *    catalog whose formula PARSES.** `fire_system_healthy` is *"no fault ∧ no
 *    isolate ∧ mains ∧ battery ∧ comms"*, and all five inputs are declared
 *    binaries here, so `{fire_fault_state}`-style arithmetic would express it
 *    under `bms-calc-v1`. It is refused anyway: a health flag over states is
 *    `content.health`'s job — ADR 0050's surface, not a template point — each of
 *    the five inputs already raises its own alarm, and a roll-up restates five
 *    decisions as one number with no way back to which input moved it. **Every
 *    other deferral in this pack is a code that cannot be written; this one is a
 *    code that should not be.**
 *  - **A time window the grammar has no state for** — `isolation_hours_month`
 *    and `jockey_starts_per_hour`. `bms-calc-v1` has arithmetic, parentheses and
 *    five functions and no clock and no memory. The `zone_isolated_too_long` and
 *    `jockey_pump_cycling` alarms bind the STATE and say so: the window and the
 *    rate are the rule's to evaluate (`E2.4`).
 *  - **An asset attribute the grammar cannot read** — `fire_pump_run_unplanned`
 *    needs the site's TEST SCHEDULE to know what *unplanned* means. The
 *    `fire_pump_running_unplanned` alarm carries the meaning in words instead.
 *
 * **NO `content.kpis`** (ADR 0054 decision 6): every ratio §2 names is a named
 * deferral, so there is no expressible quantity left over for a KPI to hold.
 *
 * **ELEVEN ALARMS FROM ELEVEN BULLETS** — the only entry in the pack where the
 * mapping is one for one. Every row is **pair-absent**: no `thresholdValue`, no
 * `operator` (ADR 0019 Amendment 2, ADR 0054 decision 5, B7). **And no row
 * carries a number at all, in the message or inside the `philosophy`** — because
 * the standards fix the state vocabulary and fix no limit a template could ship.
 * How long a zone may stay isolated, the standing pressure a hydrant header
 * holds and the level a fire tank's make-up must keep it above are all set by
 * the site's fire officer at commissioning, against that building's own risk
 * assessment. The one field on this entry that carries a standard's number is
 * `complianceRef` on the annual functional test, and that is a **citation**, not
 * a limit.
 *
 * **SEVEN OF THE ELEVEN CARRY NO `skill`, AND THIS ENTRY IS WHERE THE PACK'S
 * RULE COMES FROM** (plan §12 ruling 4 — the distinction ADR 0054 decision 5 was
 * reaching for). `bms.alarm_skills` holds five trades from migration `0034` —
 * `electrical`, `mechanical`, `hvac`, `controls`, `civil` — and **no fire,
 * security or life-safety trade**. So: **a trade answers the panel's own
 * infrastructure; none of the five answers the EVENT the panel reports.**
 *
 *  - **No skill (7)** — `fire_alarm`, `fire_fault`, `fire_supervisory`,
 *    `zone_isolated_too_long`, `panel_earth_fault`,
 *    `fire_pump_running_unplanned`, `hydrant_header_pressure_low`. The responder
 *    is the site's fire function, and filing a fire event under `controls`
 *    because a field wanted a value is the guessing this rule prevents.
 *  - **A trade answers (4)** — `panel_on_battery` is `electrical` (the panel's
 *    mains supply), `panel_comms_loss` is `controls` (the gateway link),
 *    `fire_tank_level_low` is `civil` (the tank and its make-up supply) and
 *    `jockey_pump_cycling` is `mechanical` (the pump).
 *
 * `F4.78` is the backlog row that files the missing trades; when it lands, the
 * seven gain a `skill` in a `stockVersion: 2`.
 *
 * **`jockey_pump_cycling` IS THE ONE `operations` ROW.** A jockey pump starting
 * repeatedly is a leak in the ring main — a maintenance finding on the wet
 * system, not a life-safety event — and filing it `safety` would put it beside
 * the fire alarm on every screen that groups by category.
 *
 * **MAINTENANCE — 4 plans, PROVISIONAL** (ADR 0054 decision 8), derived from
 * NFPA 72 and IS 2189 test practice, because the tag list has no maintenance
 * section. **Two are `safetyCritical`**: the panel standby battery test and the
 * annual detector and zone functional test, which are the two barriers that fail
 * silently — a flat battery and a dead detector both look exactly like a quiet
 * building. **None is `condition_based`**, and that is authoring rather than
 * omission: all four intervals are fixed by a standard and the site's fire
 * officer, and no measured row here generates a work order.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the site's
 * telemetry wiring — here, the panel's gateway object or its relay contacts —
 * which the tag list does not know and the catalog must not guess.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `facility-fire-panel` **v1** (2026-09-04, `E5.3`): authored from
 *    `e5.3-derived-taglist-v1.md` §2, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const FACILITY_FIRE_PANEL: StockAssetTemplateEntry = {
  code: "facility-fire-panel",
  name: "Fire alarm panel (FACP)",
  assetType: "fire_panel",
  domain: "facility",
  description:
    "One fire alarm control panel, addressable or conventional, as a gateway presents it: the " +
    "alarm, fault, supervisory, pre-alarm and isolate states whose vocabulary NFPA 72 and IS " +
    "2189 fix, the panel's own mains, battery, earth-fault and link health, the per-zone alarm, " +
    "fault and isolate states, device counts, sounder state, the wet system's fire and jockey " +
    "pump status with hydrant header pressure and fire tank level, sprinkler flow and suppression " +
    "release, and the weekly test logged by hand. THE BMS OBSERVES ONLY — reset, silence and " +
    "isolate stay on the panel and are deliberately outside this template. Authored from " +
    "docs/e5.3-derived-taglist-v1.md §2 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required, X optional and the M row is entered by hand; " +
    "alarm rows carry a meaning and no limit, because the standards fix the state names and the " +
    "site's fire officer fixes every window and level.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "fire_alarm",
        pointKey: "fire_alarm_state",
        severity: "critical",
        category: "safety",
        message:
          "Fire alarm active on a zone. The panel has made this decision and the BMS is reporting " +
          "it, not qualifying it. This row escalates on its own path and is never suppressed by a " +
          "monitoring schedule.",
        philosophy: {
          cause:
            "A detector, a manual call point, a sprinkler flow switch or a suppression release " +
            "has operated. It may be a fire; it may equally be dust, steam, hot work, a failed " +
            "detector or an accidental operation of a call point. The panel does not distinguish " +
            "and neither does this row.",
          impact:
            "The building's fire plan is running: sounders, evacuation, plant shutdowns and " +
            "lift homing where they are interlocked. Everything else on this template stops " +
            "mattering until the event is resolved.",
          action:
            "Follow the site's fire plan, which is the only authority here. The panel's own " +
            "display carries the zone and the device address, and the investigation happens at " +
            "the panel and then at the zone. Nothing about this event is answered from a " +
            "monitoring screen.",
        },
      },
      {
        code: "fire_fault",
        pointKey: "fire_fault_state",
        severity: "warning",
        category: "safety",
        message:
          "Fault or trouble active on the panel. Some part of the detection system is not working " +
          "and may not detect.",
        philosophy: {
          cause:
            "An open or short circuit on a loop, a removed or failed detector, a device that has " +
            "stopped answering its poll, a charger or battery fault, or a module the panel can no " +
            "longer see.",
          impact:
            "Coverage is reduced somewhere, and the panel cannot say the protected area is " +
            "protected. A fault left standing is how a building arrives at a fire with detection " +
            "that was never going to operate.",
          action:
            "Read the fault at the panel to get the loop and the device address, then have the " +
            "fire contractor attend. A fault is a defect with a clock on it under the site's fire " +
            "regime, and the clock starts when it appears here.",
        },
      },
      {
        code: "fire_supervisory",
        pointKey: "fire_supervisory_state",
        severity: "warning",
        category: "safety",
        message:
          "Supervisory signal active — a monitored valve or a pump supervision circuit has " +
          "changed state. The detection system is healthy; something the water supply depends on " +
          "is not in its normal condition.",
        philosophy: {
          cause:
            "A sprinkler or hydrant control valve moved off its fully open position and tripped " +
            "its tamper switch, a fire pump left out of automatic, or a supervised circuit on the " +
            "wet system that has changed state.",
          impact:
            "The detection will still operate; the WATER may not arrive. A closed valve is the " +
            "failure mode a sprinkler system is least able to report any other way, which is " +
            "exactly why it is supervised.",
          action:
            "Find the supervised device the panel names and restore it to its normal condition, " +
            "then confirm the signal clears. Treat a valve tamper as urgent even though the " +
            "severity is a warning: the system reads as healthy while it is standing.",
        },
      },
      {
        code: "zone_isolated_too_long",
        pointKey: "fire_isolate_state",
        severity: "warning",
        category: "safety",
        message:
          "A zone or a device has been isolated or disabled for longer than this site permits. " +
          "The permitted window is the site's, set by its fire officer, and the rule holds it — " +
          "this row carries the state.",
        philosophy: {
          cause:
            "An isolation put in for hot work, a dusty construction area, a contractor's testing " +
            "or a faulty device that kept operating, and then not removed when the work finished. " +
            "This is the most common way a building loses cover.",
          impact:
            "The isolated part of the system will not raise an alarm. The panel looks quiet and " +
            "healthy, which is why an isolation left standing is more dangerous than a fault: a " +
            "fault announces itself and an isolation does not.",
          action:
            "Find who requested the isolation and why, and restore the affected devices to " +
            "service once the work that needed it is finished. If the isolation covers a faulty " +
            "device, the fix is the repair, not a longer isolation.",
        },
      },
      {
        code: "panel_on_battery",
        pointKey: "panel_ac_ok",
        severity: "warning",
        category: "safety",
        message:
          "Panel mains supply lost — the panel is running on its standby battery. The battery " +
          "holds the system up for the period it was sized for and no longer.",
        philosophy: {
          cause:
            "A supply failure at the site, a tripped or switched-off breaker on the panel's " +
            "dedicated circuit, a failed charger or power supply module, or work on the board " +
            "that feeds the panel.",
          impact:
            "The panel keeps working until the battery is exhausted, then the whole detection " +
            "system is down. A standby battery is sized for a quiet period plus an alarm load, " +
            "and an alarm during the outage shortens it sharply.",
          action:
            "Restore the mains supply as the priority. The panel's circuit is a dedicated, " +
            "labelled and usually locked-off one for this reason, so check first whether it was " +
            "switched off during other work.",
          skill: "electrical",
        },
      },
      {
        code: "panel_earth_fault",
        pointKey: "panel_earth_fault",
        severity: "warning",
        category: "safety",
        message:
          "Earth fault on the loop wiring. The system is still operating, and a second fault on " +
          "the same loop may not leave it operating.",
        philosophy: {
          cause:
            "Damaged cable insulation, water in a junction box or a device base, a screen or " +
            "drain wire touching earth at a device, or damage done during other trades' work in " +
            "a ceiling void.",
          impact:
            "A single earth fault is tolerated by design and a second one on the same loop can " +
            "take the loop down. It is also the symptom of water ingress that will get worse.",
          action:
            "Have the fire contractor trace the fault to a loop section rather than clearing the " +
            "indication. An earth fault that keeps returning after rain is a cable or an " +
            "enclosure, not a device.",
        },
      },
      {
        code: "panel_comms_loss",
        pointKey: "panel_comms_ok",
        severity: "critical",
        category: "safety",
        message:
          "The gateway to panel link is down. This is the silent failure: with the link down the " +
          "BMS reports no alarm, no fault and no supervisory signal from this panel, and every " +
          "other row on this asset goes quiet in exactly the way a healthy building looks.",
        philosophy: {
          cause:
            "A failed or powered-down gateway, a pulled or damaged interface cable, a changed " +
            "panel interface configuration, or the panel's own communications card failing. " +
            "Panel work by the fire contractor is a frequent and legitimate cause.",
          impact:
            "The BMS is blind to the panel while the panel itself keeps working. Nobody watching " +
            "a screen learns anything, and the absence of alarms will be read as good news. The " +
            "panel's own display and sounders are unaffected.",
          action:
            "Treat the panel as unmonitored from the BMS until the link is back, and tell whoever " +
            "relies on the screen. Check whether the fire contractor is on site before assuming a " +
            "failure. Prove the link by watching a state change, not by the absence of alarms.",
          skill: "controls",
        },
      },
      {
        code: "fire_pump_running_unplanned",
        pointKey: "fire_pump_status",
        severity: "warning",
        category: "safety",
        message:
          "Fire pump running outside a test. The site's test schedule is what makes a run planned " +
          "or unplanned, and the catalog does not hold it — which is why fire_pump_run_unplanned " +
          "is deferred and this row carries the meaning instead.",
        philosophy: {
          cause:
            "A demand on the wet system: a sprinkler head has operated, a hydrant is in use, or " +
            "there is a substantial leak or a burst on the ring main. A pressure switch stuck " +
            "closed or a jockey pump that can no longer hold the header will also start it.",
          impact:
            "If it is a real demand, water is flowing somewhere and a fire alarm or a flow switch " +
            "should agree. If it is not, the pump runs against a closed system and can overheat, " +
            "and the tank empties for nothing.",
          action:
            "Look for the fire alarm and the sprinkler flow state beside this row first — they " +
            "tell you whether the demand is real. Then walk the ring main and check the header " +
            "pressure and the tank level.",
        },
      },
      {
        code: "hydrant_header_pressure_low",
        pointKey: "hydrant_header_pressure_bar",
        severity: "critical",
        category: "safety",
        message:
          "Hydrant or sprinkler header pressure below the standing band this site holds. The band " +
          "is set at commissioning from the system's design and its highest outlet.",
        philosophy: {
          cause:
            "A leak or a burst on the ring main, a jockey pump that has failed or lost its " +
            "automatic control, a closed or partly closed control valve, or a drain or test valve " +
            "left open after work.",
          impact:
            "The wet system cannot deliver water at the pressure it was designed for, so a " +
            "sprinkler head or a hydrant may not perform when it operates. This is the condition " +
            "that turns a manageable fire into a spreading one.",
          action:
            "Check the jockey pump and the valve line-up first, then look for the leak. This is a " +
            "wet-system emergency even though nothing is burning; the site's fire officer should " +
            "know within the hour.",
        },
      },
      {
        code: "fire_tank_level_low",
        pointKey: "fire_tank_level_pct",
        severity: "critical",
        category: "safety",
        message:
          "Fire water tank level below the level this site keeps it above. The level is the fire " +
          "officer's, set from the stored volume the building's risk assessment requires.",
        philosophy: {
          cause:
            "A failed or isolated make-up supply, a stuck float or level valve, a leak in the " +
            "tank or its outlet, or water drawn for a test or a real demand that has not been " +
            "replaced.",
          impact:
            "The stored volume is what the fire pumps run on, and it is sized for a duration. A " +
            "tank below its level shortens that duration and can leave the pumps drawing air.",
          action:
            "Restore the make-up supply and find why the level fell — a tank that empties slowly " +
            "and repeatedly is a leak, and a tank that empties once is usually a test that nobody " +
            "logged. Check the tank structure and its outlet while it is accessible.",
          skill: "civil",
        },
      },
      {
        code: "jockey_pump_cycling",
        pointKey: "jockey_pump_status",
        severity: "warning",
        category: "operations",
        message:
          "Jockey pump starting repeatedly. The rate that counts as cycling is the rule's to " +
          "evaluate over this run status — jockey_starts_per_hour is deferred, because the " +
          "formula grammar has no clock.",
        philosophy: {
          cause:
            "A leak in the ring main, a dripping hydrant landing valve or test valve, a passing " +
            "non-return valve, or a pressure vessel that has lost its air charge so the pump has " +
            "nothing to hold pressure against.",
          impact:
            "Each start wears the jockey pump and its starter, and the leak that causes the " +
            "cycling grows. Left alone it ends as a header pressure alarm and a main fire pump " +
            "running against a leak.",
          action:
            "Find the leak rather than the pump: walk the ring main and check the landing and " +
            "test valves. If nothing is leaking, check the pressure vessel's air charge and the " +
            "non-return valve on the pump's discharge.",
          skill: "mechanical",
        },
      },
    ],
    maintenance: [
      {
        title: "Weekly fire alarm test",
        category: "compliance",
        generationMode: "calendar",
        intervalDays: 7,
        estimatedMinutes: 20,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Operate one manual call point on a rotating schedule so that every call point is " +
          "tested over a cycle, confirm the sounders operate and the panel indicates the right " +
          "zone, and record the result against weekly_test_done — the M row this entry declares " +
          "for exactly this task. The rotation is what makes a weekly test cover the building " +
          "rather than one door.",
      },
      {
        title: "Panel standby battery test",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 180,
        estimatedMinutes: 60,
        priority: "critical",
        safetyCritical: true,
        triggerSummary:
          "Prove the standby batteries hold the panel up for the period they were sized for with " +
          "the mains supply removed, and check the charger, the terminals and the battery dates. " +
          "This is one of the two barriers on this entry that fail silently: a flat battery looks " +
          "exactly like a healthy panel until the supply goes, and panel_ac_ok reports the mains, " +
          "not the battery's remaining capacity.",
      },
      {
        title: "Annual detector and zone functional test",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 480,
        priority: "critical",
        safetyCritical: true,
        complianceRef: "NFPA 72 / IS 2189",
        triggerSummary:
          "Functionally test every detector and every zone with the appropriate stimulus, check " +
          "sensitivity and clean where the device type requires it, and prove each zone annunciates " +
          "correctly at the panel and drives its interlocks. The second silent barrier: a detector " +
          "that has drifted or been painted over reports nothing at all, and no state on this " +
          "template would show it. Restore every isolation used during the test before leaving.",
      },
      {
        title: "Fire and jockey pump weekly run test",
        category: "inspection_round",
        generationMode: "calendar",
        intervalDays: 7,
        estimatedMinutes: 30,
        priority: "high",
        safetyCritical: false,
        triggerSummary:
          "Run the fire pump and the jockey pump on their weekly test and watch fire_pump_status " +
          "and jockey_pump_status confirm it, with hydrant_header_pressure_bar recovering and " +
          "fire_tank_level_pct where it should be. Check the diesel set's fuel, oil and battery " +
          "where one is fitted. A pump that starts every week is a pump that will start on demand, " +
          "and this round is also what tells a reader that a run seen on the panel was planned.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "fire_alarm_state", label: "Fire alarm active (any zone)", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "fire_fault_state", label: "Fault / trouble active (any)", unit: null, required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "fire_supervisory_state", label: "Supervisory active (valve tamper, pump)", unit: null, required: false, sortOrder: 2, meta: EXTENDED },
    { ...MEASURED, pointKey: "fire_isolate_state", label: "Any zone / device isolated (disabled)", unit: null, required: true, sortOrder: 3, meta: CORE },
    { ...MEASURED, pointKey: "fire_prealarm_state", label: "Pre-alarm / early warning", unit: null, required: false, sortOrder: 4, meta: EXTENDED },
    { ...MEASURED, pointKey: "panel_ac_ok", label: "Panel mains supply healthy", unit: null, required: true, sortOrder: 5, meta: CORE },
    { ...MEASURED, pointKey: "panel_battery_ok", label: "Panel standby battery healthy", unit: null, required: true, sortOrder: 6, meta: CORE },
    { ...MEASURED, pointKey: "panel_earth_fault", label: "Earth fault on loop wiring", unit: null, required: false, sortOrder: 7, meta: EXTENDED },
    // Declared HERE, and NOT the same code as §3's controller_comms_ok: this is
    // the link to the FIRE panel, and panel_comms_loss is the pack's only
    // critical comms row.
    { ...MEASURED, pointKey: "panel_comms_ok", label: "Gateway ↔ panel link healthy", unit: null, required: true, sortOrder: 8, meta: CORE },
    // The panel-level per-zone roll-ups. A child asset per zone is a v2 shape
    // behind F2.10; a site that wants it today builds it with an asset group.
    { ...MEASURED, pointKey: "zone_alarm_state", label: "Alarm, per zone / loop", unit: null, required: true, sortOrder: 9, meta: CORE },
    { ...MEASURED, pointKey: "zone_fault_state", label: "Fault, per zone / loop", unit: null, required: true, sortOrder: 10, meta: CORE },
    { ...MEASURED, pointKey: "zone_isolated_state", label: "Isolated, per zone", unit: null, required: false, sortOrder: 11, meta: EXTENDED },
    { ...MEASURED, pointKey: "active_alarm_count", label: "Devices in alarm", unit: null, required: false, sortOrder: 12, meta: EXTENDED },
    { ...MEASURED, pointKey: "active_fault_count", label: "Devices in fault", unit: null, required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "sounder_active", label: "Sounders / NAC active", unit: null, required: false, sortOrder: 14, meta: EXTENDED },
    // Observe-only cuts the COMMAND, not the observation: the panel reporting
    // that somebody silenced it at the panel is what this entry exists for.
    { ...MEASURED, pointKey: "sounder_silenced", label: "Alarm silenced at panel", unit: null, required: false, sortOrder: 15, meta: EXTENDED },
    { ...MEASURED, pointKey: "fire_pump_status", label: "Fire pump run (electric / diesel)", unit: null, required: false, sortOrder: 16, meta: EXTENDED },
    { ...MEASURED, pointKey: "jockey_pump_status", label: "Jockey pump run", unit: null, required: false, sortOrder: 17, meta: EXTENDED },
    { ...MEASURED, pointKey: "hydrant_header_pressure_bar", label: "Hydrant / sprinkler header pressure", unit: "bar", required: false, sortOrder: 18, meta: EXTENDED },
    { ...MEASURED, pointKey: "fire_tank_level_pct", label: "Fire water tank level", unit: "%", required: false, sortOrder: 19, meta: EXTENDED },
    { ...MEASURED, pointKey: "sprinkler_flow_state", label: "Sprinkler flow switch", unit: null, required: false, sortOrder: 20, meta: EXTENDED },
    { ...MEASURED, pointKey: "suppression_released_state", label: "Gas / foam suppression released", unit: null, required: false, sortOrder: 21, meta: EXTENDED },
    // A REUSED code — the control room's. Referenced, never redeclared (ADR
    // 0054 decision 3), and carrying null so the catalog's own unit stands.
    { ...MEASURED, pointKey: "smoke_state", label: "Standalone smoke detector", unit: null, required: false, sortOrder: 22, meta: EXTENDED },
    // The M row: a signature in a logbook, entered through F1.8, never mapped
    // from a data key, and therefore always in skippedPoints.
    { ...MEASURED, pointKey: "weekly_test_done", label: "Weekly fire alarm test logged", unit: null, required: false, sortOrder: 23, meta: MANUAL },
  ],
};
