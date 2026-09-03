import { CORE, EXTENDED, MEASURED } from "./point-fields";
import type { StockAssetTemplateEntry } from "./types";

/**
 * The facility pack's lighting-zone class — `E5.3`, ADR 0054 decisions 1-9, ADR
 * 0052 decisions 1, 2 and 6, ADR 0019 Amendment 2.
 *
 * **SOURCE.** `docs/e5.3-derived-taglist-v1.md` §1 — *"Lighting zone — DALI-2 /
 * relay-panel zone with sensors"*. PROVISIONAL: derived from published practice,
 * not client-confirmed. The section's basis is **DALI-2 (IEC 62386) parts 252,
 * 253, 303 and 304** — energy reporting, diagnostics and health, the occupancy
 * input device and the light sensor input device — plus relay-panel practice for
 * a zone that is switched rather than dimmed. So the fifteen rows below are what
 * a DALI-2 application controller or a lighting gateway actually publishes, and
 * not a wish list.
 *
 * **ONE TEMPLATE INSTANCE PER CONTROLLED ZONE** — a structural bay, a corridor,
 * a car-park level, a façade circuit — which is the section's own instruction.
 * A building-level roll-up is a derived tag on the hierarchy and not another
 * instance of this template.
 *
 * **15 POINTS — 5 core + 10 extended + 0 manual + 0 DERIVED.** §1's 15 table
 * rows in the document's own order (`sortOrder` 0-14) and nothing appended.
 *
 * **THE PACK'S FIRST ENTRY, AND THE ONE ITS DOMAIN IS PROVED WITH.** Every code
 * here is new vocabulary — no reused code, no promotion, no `M` row — so this is
 * also the simplest entry in the pack. What it does exercise is the domain:
 * `facility` is the **seventh `bms.asset_domains` row** and the second a pack
 * added through the seed path rather than a migration, and
 * `asset-templates-stock.integration.spec.ts` imports and publishes this entry
 * against a real database for exactly that reason. `assertAssetDomain` closes
 * `domain` against the live table at import, so a `facility` entry with no seed
 * row would be a 400 on a client's site.
 *
 * **`occupancy_state` IS DECLARED HERE** (ADR 0054 decision 3,
 * first-occurrence-wins): §1 is its first appearance in the document, so it is
 * filed under `facility` and §4's occupancy zone REFERENCES it rather than
 * redeclaring it. It is tier `C` here because a zone with no presence input
 * cannot run the control strategy the section is written around — a tier is per
 * entry, so §4 is free to file the same code differently.
 *
 * **FIVE DERIVED CODES ARE DEFERRED AND NAMED, never placeholdered** (ADR 0054
 * decision 6; ADR 0051 Amendment 6 decision 8 — a code with no `bms-calc-v1`
 * formula is not vocabulary). `stock-catalog-deferrals.spec.ts` holds the list
 * and asserts this entry declares none of them:
 *
 *  - **A time window the grammar has no state for** —
 *    `lit_while_unoccupied_min_day` and `override_hours_day`. `bms-calc-v1` has
 *    arithmetic, parentheses and five functions and no clock and no memory, so
 *    minutes-per-day and hours-per-day are not expressible. The
 *    `lit_while_unoccupied` alarm below binds the STATE and says so: the window
 *    is the rule's to evaluate (`E2.4`) and the state is the parameter it
 *    evaluates over.
 *  - **An asset attribute the grammar cannot read** — `lighting_w_per_m2` needs
 *    the zone's AREA, `daylight_saving_pct` needs the full-output baseline the
 *    zone would draw with no daylight harvesting, and `lamp_availability_pct`
 *    needs the LUMINAIRE COUNT. All three are commissioning attributes of the
 *    installation; the zone reports its own power, energy and fault count and
 *    does not report how big it is or how many fittings it holds.
 *
 * **NO `content.kpis`** (ADR 0054 decision 6): every ratio §1 names is either a
 * point (none here) or a named deferral (all five). The gap the electrical
 * pack's KPI codes filled — an expressible ratio with no code — does not exist.
 *
 * **FOUR ALARMS FROM FIVE BULLETS, AND THE FIFTH IS RECORDED RATHER THAN
 * INVENTED** (plan §12 ruling 6). §1's *Alarms* line names *communication loss
 * to gateway*, and §1's table carries **no `lighting_comms_ok` row**. The
 * vocabulary is filed from the document's TABLE and not from its prose, so no
 * row was invented to give the bullet a home: a code no client has seen on the
 * handout they are redlining must not enter a write-once seed. The bullet is a
 * **v2 redline candidate for the `F2.18` handout**, and the event itself is not
 * lost — the gateway's own `device_offline` on `facility-bas-gateway` (§7) is
 * where a comms failure between the BMS and a lighting controller lives.
 * `facility-classes.spec.ts` asserts both halves of the absence: this entry
 * declares no point whose key contains `comms`, and no alarm binds one.
 *
 * **EVERY ALARM IS PAIR-ABSENT AND CARRIES A POPULATED `philosophy`** — no
 * `thresholdValue`, no `operator` (ADR 0019 Amendment 2, ADR 0054 decision 5,
 * B7): a fault count, a lux setpoint and a schedule window are all commissioning
 * values, set per site. The meaning lives in the message and in `cause`,
 * `impact` and `action`.
 *
 * **ALL FOUR ROWS CARRY A `skill`, and none of the pack's 16 no-skill rows is
 * here.** Three are `electrical` — a lamp, a driver and an emergency battery are
 * a wireman's work — and `lit_while_unoccupied` is `controls`, because the thing
 * that is wrong is a SCHEDULE or a sensor binding and not a fitting.
 *
 * **`lit_while_unoccupied` IS `info` / `energy` ON PURPOSE.** A zone burning
 * outside its schedule with nobody in it is a cost and not a failure. Raising it
 * to `warning` is how an operator learns to ignore the panel at night, which
 * then costs the rows that do matter.
 *
 * **MAINTENANCE — 3 plans, PROVISIONAL** (ADR 0054 decision 8), derived from
 * DALI-2 emergency-test practice and luminaire service practice, because the tag
 * list has no maintenance section. **One is `safetyCritical`**: the annual
 * emergency-lighting DURATION test, which is the one that proves the escape
 * route stays lit for its rated period after a supply failure. The monthly
 * function test proves the luminaire strikes at all and is an inspection round;
 * the luminaire clean is the entry's one `condition_based` plan and names
 * `lamp_fault_count` and `illuminance_lux`, the two rows whose movement IS the
 * trigger.
 *
 * **`sourceDataKeyPattern` IS `null` ON EVERY POINT**: the pattern is the site's
 * telemetry wiring — here, the DALI address or the gateway object the integrator
 * mapped — which the tag list does not know and the catalog must not guess. An
 * imported draft cannot be instantiated until an operator fills the patterns in.
 *
 * **VERSION HISTORY** (ADR 0052 decision 6):
 *
 *  - `facility-lighting-zone` **v1** (2026-09-04, `E5.3`): authored from
 *    `e5.3-derived-taglist-v1.md` §1, PROVISIONAL — derived, not
 *    client-confirmed.
 */
export const FACILITY_LIGHTING_ZONE: StockAssetTemplateEntry = {
  code: "facility-lighting-zone",
  name: "Lighting zone (DALI-2 / relay panel)",
  assetType: "lighting_zone",
  domain: "facility",
  description:
    "One controlled lighting zone — a structural bay, a corridor, a car-park level or a façade " +
    "circuit — on a DALI-2 application controller or a relay panel with sensors: on/off and " +
    "dimming state, control mode and scene, occupancy and working-plane illuminance with its " +
    "daylight-harvesting setpoint, lamp and driver faults, the emergency-lighting test result and " +
    "battery health, and the zone's own power, energy and burn hours. A building-level roll-up is " +
    "a hierarchy tag, not another instance of this template. Authored from " +
    "docs/e5.3-derived-taglist-v1.md §1 (PROVISIONAL — derived from published practice, not " +
    "client-confirmed). Tier C points are required and X optional; alarm rows carry a meaning and " +
    "no limit, because a fault count, a lux setpoint and a schedule window are set per site at " +
    "commissioning. No derived point is authored here: two of the section's five ratios are time " +
    "windows and three divide by an attribute of the installation the zone does not report.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    alarms: [
      {
        code: "lamp_fault_count_high",
        pointKey: "lamp_fault_count",
        severity: "warning",
        category: "operations",
        message:
          "Luminaires reporting a lamp or driver failure above the count this zone is allowed to " +
          "run with. The count is set per site at commissioning, from the zone's fitting count " +
          "and the lighting level the space is designed for.",
        philosophy: {
          cause:
            "End-of-life LED drivers, a batch of fittings ageing together because they were " +
            "installed together, a supply disturbance that took several drivers at once, or " +
            "water ingress in an external or wash-down zone.",
          impact:
            "The zone is below the illuminance it was designed for, and the remaining fittings " +
            "carry the whole duty. In a working area that is a task-lighting and a safety " +
            "question; on a stair or a corridor it is an egress one.",
          action:
            "Read the driver diagnostics off the controller to find which addresses are " +
            "reporting, then replace the failed drivers or lamps on the next luminaire round " +
            "rather than one at a time. A whole batch reporting together is a batch " +
            "replacement, not a repair.",
          skill: "electrical",
        },
      },
      {
        code: "emergency_test_failed_or_overdue",
        pointKey: "emergency_test_state",
        severity: "warning",
        category: "safety",
        message:
          "Emergency-lighting test result is fail, or the test is due and has not run. The state " +
          "enum carries which of the two it is; the permitted overdue window is the site's.",
        philosophy: {
          cause:
            "An emergency luminaire whose battery no longer holds its rated duration, a failed " +
            "charger or lamp in the emergency fitting, an isolated circuit that stops the test " +
            "from running, or a controller whose test schedule was never set.",
          impact:
            "The escape route may not stay lit after a supply failure, and the site cannot show " +
            "that it tested. This is the row a fire officer asks about, and a failed test that " +
            "nobody answers is the same as no emergency lighting at all.",
          action:
            "Find which fittings reported the fail from the controller's own log and replace the " +
            "battery pack or the fitting. If the state is due rather than fail, run the test and " +
            "then check why the schedule did not fire — an overdue test usually means the " +
            "schedule, not the battery.",
          skill: "electrical",
        },
      },
      {
        code: "lit_while_unoccupied",
        pointKey: "lighting_state",
        severity: "info",
        category: "energy",
        message:
          "Zone lit outside its schedule with no occupancy detected. The rule reads " +
          "schedule_active and occupancy_state beside this state, and the window it must persist " +
          "for is set per site: a corridor and a warehouse aisle answer this differently.",
        philosophy: {
          cause:
            "A manual override left on after a shift, a schedule that no longer matches how the " +
            "space is used, an occupancy sensor masked by stock or a partition, or a sensor hold " +
            "time set far longer than the space needs.",
          impact:
            "Energy is spent lighting an empty space, and burn hours accumulate on fittings that " +
            "nobody is using, which brings their replacement forward. Nothing is unsafe, which " +
            "is why this row is informational.",
          action:
            "Check whether the mode is a manual override first — that is the usual answer and it " +
            "clears itself at the next schedule boundary. If the mode is auto, the schedule or " +
            "the sensor placement is wrong and belongs in a controls review, not a lamp change.",
          skill: "controls",
        },
      },
      {
        code: "illuminance_low_at_full_output",
        pointKey: "illuminance_lux",
        severity: "warning",
        category: "operations",
        message:
          "Working-plane illuminance below the daylight-harvesting setpoint while the zone is " +
          "already dimming at full output — the zone cannot reach the level it is asked for. " +
          "Both the setpoint and the tolerance are site values.",
        philosophy: {
          cause:
            "Lamp lumen depreciation over life, dirt on the fittings, diffusers or the lens of " +
            "the daylight sensor, luminaires out of service that the fault count has not yet " +
            "reached its own threshold on, or a space whose layout or finishes changed after the " +
            "lighting was designed.",
          impact:
            "The task lighting is below its design level while the zone draws its full power, so " +
            "the space is both under-lit and inefficient. The daylight-harvesting loop is also " +
            "saturated and can no longer save anything.",
          action:
            "Clean the luminaires and the sensor lens first — that recovers most of the loss on " +
            "an ageing installation. Then check the fault count and the sensor's own position " +
            "before concluding that the zone needs relamping or redesign.",
          skill: "electrical",
        },
      },
    ],
    maintenance: [
      {
        title: "Emergency-lighting annual duration test",
        category: "safety_critical",
        generationMode: "calendar",
        intervalDays: 365,
        estimatedMinutes: 120,
        priority: "critical",
        safetyCritical: true,
        triggerSummary:
          "Run the full-duration discharge test on every emergency luminaire in the zone and " +
          "record the result against emergency_test_state. This is the test that proves the " +
          "escape route stays lit for its rated period after a supply failure — the monthly " +
          "function test only proves the fitting strikes — and it is the one a fire officer asks " +
          "for evidence of. Recharge time after the test is part of the task: a zone tested and " +
          "left uncharged is unprotected until it recovers.",
      },
      {
        title: "Monthly emergency-lighting function test",
        category: "inspection_round",
        generationMode: "calendar",
        intervalDays: 30,
        estimatedMinutes: 20,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Trigger the short function test from the controller and confirm every emergency " +
          "luminaire in the zone strikes and its emergency_battery_ok flag stays healthy. This " +
          "catches a failed lamp or charger between annual duration tests, and it is what keeps " +
          "the emergency_test_failed_or_overdue alarm quiet.",
      },
      {
        title: "Luminaire clean and lamp/driver replacement on fault count",
        category: "condition_based",
        generationMode: "condition",
        intervalDays: 90,
        estimatedMinutes: 120,
        priority: "medium",
        safetyCritical: false,
        triggerSummary:
          "Generated when lamp_fault_count rises or illuminance_lux falls away from its setpoint " +
          "with the zone at full output. Clean the fittings, the diffusers and the daylight " +
          "sensor lens, then replace the drivers and lamps the controller's diagnostics name. " +
          "Dirt and lumen depreciation account for most of the loss on an ageing installation, " +
          "so the clean is done before anything is judged to need relamping.",
      },
    ],
  },
  points: [
    { ...MEASURED, pointKey: "lighting_state", label: "Zone on / off", unit: null, required: true, sortOrder: 0, meta: CORE },
    { ...MEASURED, pointKey: "lighting_level_pct", label: "Dimming level (DALI arc power)", unit: "%", required: true, sortOrder: 1, meta: CORE },
    { ...MEASURED, pointKey: "lighting_mode", label: "Auto (schedule/sensor) / manual override / off", unit: null, required: true, sortOrder: 2, meta: CORE },
    { ...MEASURED, pointKey: "lighting_scene", label: "Active scene number", unit: null, required: false, sortOrder: 3, meta: EXTENDED },
    // Declared HERE — §1 is this code's first occurrence in the document, so it
    // is filed under `facility` and §4's occupancy zone references it rather
    // than redeclaring it (ADR 0054 decision 3). Tier C: a zone with no
    // presence input cannot run the strategy the section is written around.
    { ...MEASURED, pointKey: "occupancy_state", label: "Occupancy detected (PIR / microwave)", unit: null, required: true, sortOrder: 4, meta: CORE },
    { ...MEASURED, pointKey: "illuminance_lux", label: "Working-plane illuminance (daylight sensor)", unit: "lux", required: false, sortOrder: 5, meta: EXTENDED },
    { ...MEASURED, pointKey: "illuminance_sp_lux", label: "Daylight-harvesting lux setpoint", unit: "lux", required: false, sortOrder: 6, meta: EXTENDED },
    { ...MEASURED, pointKey: "lamp_fault_count", label: "Luminaires reporting lamp / driver failure", unit: null, required: false, sortOrder: 7, meta: EXTENDED },
    { ...MEASURED, pointKey: "driver_fault_state", label: "Any driver fault in zone", unit: null, required: false, sortOrder: 8, meta: EXTENDED },
    { ...MEASURED, pointKey: "emergency_test_state", label: "Emergency-lighting test result (pass/fail/due)", unit: null, required: false, sortOrder: 9, meta: EXTENDED },
    { ...MEASURED, pointKey: "emergency_battery_ok", label: "Emergency luminaire battery healthy", unit: null, required: false, sortOrder: 10, meta: EXTENDED },
    { ...MEASURED, pointKey: "zone_kw", label: "Zone lighting power (DALI-252 or circuit meter)", unit: "kW", required: false, sortOrder: 11, meta: EXTENDED },
    { ...MEASURED, pointKey: "zone_kwh_total", label: "Zone lighting energy", unit: "kWh", required: false, sortOrder: 12, meta: EXTENDED },
    { ...MEASURED, pointKey: "burn_hours_h", label: "Zone burn hours", unit: "h", required: false, sortOrder: 13, meta: EXTENDED },
    { ...MEASURED, pointKey: "schedule_active", label: "Schedule currently commanding the zone", unit: null, required: true, sortOrder: 14, meta: CORE },
  ],
};
