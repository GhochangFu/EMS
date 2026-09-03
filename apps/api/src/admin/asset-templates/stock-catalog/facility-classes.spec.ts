import { DEFERRED_DERIVED_CODES } from "./stock-catalog-deferrals.spec";
import { alarmsOf, assert, maintenanceOf, requireStockEntry } from "./stock-catalog.spec";
import {
  assertAlarmTable,
  assertDeferralsAbsent,
  assertDerivedPoints,
  assertEntryIdentity,
  assertMaintenanceBounds,
  assertNoKpis,
  assertNoLimitNumbers,
  assertPhilosophyRows,
  assertPointTable,
  assertProvenance,
  assertSkillAssignment,
  tierCount,
  type AlarmRow,
  type DerivedRow,
  type PointRow,
} from "./stock-transcription.spec";

/**
 * `E5.3` pass C, the first of three transcription spec files — §1 (the lighting
 * zone) and §2 (the fire alarm panel) of `docs/e5.3-derived-taglist-v1.md`.
 *
 * **Two or three entries per file, three files in PR 1**, the cap `E5.1`
 * measured at its own first escalation checkpoint and `E5.2` repeated: the §4.5
 * pre-commit guard reads a whole file, and `water-classes.spec.ts` reached 704
 * lines with two entries in it. §1 and §2 here (plan Tasks 4 and 5), §3, §4 and
 * §5 in `facility-classes-2.spec.ts` (Tasks 6-8), §6 and §7 in `-3` (Tasks 9 and
 * 10). **This file is created with the lighting block alone and the fire panel
 * appends to it** — the runner at the foot is the seam, so Task 5 adds one
 * `check…()` call and nothing else moves.
 *
 * **Every helper is imported from `stock-transcription.spec.ts`, not restated.**
 * The `0034` skill parser, the point and alarm transcription tables, the
 * philosophy and skill assertions, the maintenance bounds, the deferral loop and
 * the provenance needles are properties of **every** stock pack, and
 * `assertEntryIdentity` and `assertProvenance` take the domain and the tag list
 * as parameters because this pack files six entries under `facility`, one under
 * `environment` and (in PR 2) two under `mechanical`, and cites its own
 * document.
 *
 * **`facility-classes.test.ts` is this file's name-sibling wrapper** —
 * `tests/repo-invariants.test.ts` matches the pair by name, and a spec imported
 * from a differently-named wrapper still runs but is absent from coverage.
 */

/** The document all nine entries of this pack cite — ADR 0054 decision 7. */
export const FACILITY_TAG_LIST = "e5.3-derived-taglist-v1.md";

/**
 * The regime sentence `assertNoLimitNumbers` prints when a life-safety row is
 * caught carrying a digit — the facility pack's equivalent of the water pack's
 * CPCB Schedule VI consent sentence and the boiler's IBR one.
 *
 * **The rule is the same and the regime is not**, which is why the helper takes
 * this as a parameter: a message naming the wrong regulator sends the reader to
 * the wrong document. It is safe for this string to carry the standard numbers
 * because it is interpolated only into the FAILURE message; the rows themselves
 * carry none, in the alarm text and inside the `philosophy` too.
 */
export const FACILITY_LIFE_SAFETY_REGIME =
  "NFPA 72 and IS 2189 fix the STATE VOCABULARY a fire panel reports — alarm, fault, " +
  "supervisory, pre-alarm, isolate — and fix no number a template could ship. Every window and " +
  "every level is the site's: how long a zone may stay isolated, the standing pressure a hydrant " +
  "header holds, the level a fire tank's make-up supply must keep it above. All three are set by " +
  "the site's fire officer at commissioning, against that building's own risk assessment.";

// ===========================================================================
// §1 — `facility-lighting-zone`
// ===========================================================================

const LIGHTING_CODE = "facility-lighting-zone";

/**
 * §1's 15 table rows in the document's own order (`sortOrder` 0-14) —
 * `[pointKey, tier, unit]`. Nothing is appended: §1 promotes no derived code.
 *
 * **No code here is reused and every one is new vocabulary**, which makes this
 * the cleanest table in the pack and the right one to open a pack with. Six
 * rows carry a unit — `%`, `lux` twice, `kW`, `kWh` and `h` — and the other
 * nine carry `null`, because the document's Unit column says `0/1`, `enum` or
 * `count` and ADR 0051 Amendment 6 decision 4 spells all three `""` in the
 * vocabulary. A template `unit` of `null` defers to the catalog rather than
 * overriding it, and an override here would ship to every organization that
 * imports the entry and could not be corrected by a later seed, because
 * `UNIT_BY_KEY`'s seed is `COALESCE(existing, excluded)`.
 *
 * `occupancy_state` is **declared here**, its first occurrence in the document,
 * and §4's occupancy zone references it rather than redeclaring it (ADR 0054
 * decision 3, first-occurrence-wins). It is `core` on this entry because a
 * lighting zone with no presence input cannot run the control strategy the
 * section is written around.
 */
const LIGHTING_POINTS: readonly PointRow[] = [
  ["lighting_state", "core", null],
  ["lighting_level_pct", "core", "%"],
  ["lighting_mode", "core", null],
  ["lighting_scene", "extended", null],
  ["occupancy_state", "core", null],
  ["illuminance_lux", "extended", "lux"],
  ["illuminance_sp_lux", "extended", "lux"],
  ["lamp_fault_count", "extended", null],
  ["driver_fault_state", "extended", null],
  ["emergency_test_state", "extended", null],
  ["emergency_battery_ok", "extended", null],
  ["zone_kw", "extended", "kW"],
  ["zone_kwh_total", "extended", "kWh"],
  ["burn_hours_h", "extended", "h"],
  ["schedule_active", "core", null],
];

/**
 * §1 authors **no** derived point, and the empty table is the claim.
 *
 * All five codes §1's *Derived:* line names are deferred (plan §5.0): two are
 * time windows `bms-calc-v1` has no state for, and three divide by an asset
 * attribute the grammar cannot read — the zone's area, its full-output baseline
 * and its luminaire count. Passing an empty table rather than skipping
 * `assertDerivedPoints` is what makes a later "helpful" formula fail here.
 */
const LIGHTING_DERIVED: readonly DerivedRow[] = [];

/**
 * §1's five alarm bullets become **four** rows, and the missing one is the
 * point of {@link assertNoAlarmBindsACommsPoint} below.
 *
 * `lit_while_unoccupied` is the pack's first `energy` row and its only `info`
 * one here: a zone burning outside its schedule with nobody in it is a cost, not
 * a failure, and paging somebody for it at night is how an operator learns to
 * ignore the panel.
 */
const LIGHTING_ALARMS: readonly AlarmRow[] = [
  ["lamp_fault_count_high", "lamp_fault_count", "warning", "operations"],
  ["emergency_test_failed_or_overdue", "emergency_test_state", "warning", "safety"],
  ["lit_while_unoccupied", "lighting_state", "info", "energy"],
  ["illuminance_low_at_full_output", "illuminance_lux", "warning", "operations"],
];

/**
 * **The dropped bullet, asserted as an absence** (plan §12 ruling 6).
 *
 * §1's *Alarms* line names five events and this entry carries four. The fifth —
 * *communication loss to gateway* — has **no point to bind**: §1's table carries
 * no `lighting_comms_ok` row, and ADR 0054 decision 3 files the vocabulary from
 * the document's table and not from its prose. Inventing the row to give the
 * bullet a home would put a code into a write-once vocabulary that no client has
 * seen on the handout they are redlining.
 *
 * So the bullet is **recorded rather than invented**: it is a v2 redline
 * candidate for the `F2.18` handout, and the event itself is not lost — the
 * gateway's own `device_offline` on `facility-bas-gateway` (§7) is where a comms
 * failure between the BMS and a lighting controller actually lives.
 *
 * Both halves are asserted, because either alone is weak. No declared point key
 * may contain `comms` (so a later author cannot quietly add the row), and no
 * alarm may bind one (so a later author cannot bind §7's key from here).
 */
function assertNoAlarmBindsACommsPoint(entry = requireStockEntry(LIGHTING_CODE)): void {
  const commsPoints = entry.points.filter((point) => point.pointKey.includes("comms"));
  assert(
    commsPoints.length === 0,
    `${LIGHTING_CODE} declares a comms point (${commsPoints.map((p) => p.pointKey).join(", ")}), ` +
      "and §1's table carries none. §1's fifth alarm bullet — communication loss to gateway — has " +
      "NO row to bind, and lighting_comms_ok was deliberately NOT invented for it (plan §12 " +
      "ruling 6): the vocabulary is filed from the document's TABLE, not its prose, and a code no " +
      "client has seen on the handout cannot be added to a write-once seed to make a bullet " +
      "tidy. The bullet is a v2 redline for the F2.18 handout, and the event lives on " +
      "facility-bas-gateway's device_offline.",
  );
  const commsAlarms = alarmsOf(entry).filter((alarm) => alarm.pointKey.includes("comms"));
  assert(
    commsAlarms.length === 0,
    `${LIGHTING_CODE} alarm "${commsAlarms[0]?.code}" binds ${String(commsAlarms[0]?.pointKey)}, ` +
      "which this entry does not declare. §1's gateway-comms bullet is DROPPED and recorded for " +
      "F2.18, not rehomed onto another entry's key: an alarm on a point the template does not " +
      "declare fails assertContentRefsResolve at import, and binding facility-bas-gateway's row " +
      "from here would make a lighting zone's alarm depend on an asset it has no relationship to.",
  );
}

/**
 * `facility-lighting-zone` against `docs/e5.3-derived-taglist-v1.md` §1 (plan
 * §5.1) — **the pack's first entry, and the one the integration import-and-
 * publish proves the new `facility` domain row with** (plan Task 4).
 *
 * The opposite shape to `E5.2`'s opener on purpose: no reused code, no promoted
 * formula, no `M` row. What it does exercise is the domain — this is the first
 * stock entry ever filed under `facility`, so `assertAssetDomain` has to find a
 * seed row that no migration wrote.
 */
function checkLightingZone(): void {
  const entry = requireStockEntry(LIGHTING_CODE);
  assertEntryIdentity(LIGHTING_CODE, entry, "lighting_zone", "facility");

  // ---- 15 points, 5 core + 10 extended + 0 manual + 0 derived -------------

  assert(
    tierCount(entry, "core") === 5 &&
      tierCount(entry, "extended") === 10 &&
      tierCount(entry, "manual") === 0 &&
      tierCount(entry, "derived") === 0,
    `§1 marks 5 rows C and 10 X, has no M row and promotes none of its five derived codes — ` +
      `5/10/0/0. Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(LIGHTING_CODE, "§1", entry, LIGHTING_POINTS);
  assertDerivedPoints(LIGHTING_CODE, entry, LIGHTING_DERIVED);
  assertNoKpis(LIGHTING_CODE, entry, "§1");
  assertDeferralsAbsent(LIGHTING_CODE, entry);

  // ---- occupancy_state is declared HERE, and §4 references it -------------

  const occupancy = entry.points.find((point) => point.pointKey === "occupancy_state");
  assert(
    occupancy?.meta?.tier === "core" && occupancy.required === true,
    `${LIGHTING_CODE}.occupancy_state must be tier C and required. §1 is its FIRST occurrence in ` +
      "the document, so it is declared here and filed under facility, and §4's occupancy zone " +
      "references it rather than redeclaring it (ADR 0054 decision 3, first-occurrence-wins). A " +
      "tier is per ENTRY, so §4 may file it differently; what must not change is that this entry " +
      `owns the declaration. Got tier ${String(occupancy?.meta?.tier)}, required ` +
      `${String(occupancy?.required)}.`,
  );

  // ---- 4 alarms, and the fifth bullet that has no row --------------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(LIGHTING_CODE, "§1", alarms, LIGHTING_ALARMS);
  assertPhilosophyRows(LIGHTING_CODE, alarms);
  assertSkillAssignment(
    LIGHTING_CODE,
    alarms,
    {
      lamp_fault_count_high: "electrical",
      emergency_test_failed_or_overdue: "electrical",
      lit_while_unoccupied: "controls",
      illuminance_low_at_full_output: "electrical",
    },
    // Every row here carries a trade: three are luminaire, driver and emergency
    // battery work and one is a schedule. None of the pack's 14 no-skill rows is
    // on this entry, and the empty list is the CLAIM — assertSkillAssignment
    // requires the map and this list to partition the four.
    [],
  );
  assertNoAlarmBindsACommsPoint(entry);

  const litWhileUnoccupied = alarms.find((alarm) => alarm.code === "lit_while_unoccupied");
  assert(
    litWhileUnoccupied?.severity === "info" && litWhileUnoccupied.category === "energy",
    `${LIGHTING_CODE}'s lit_while_unoccupied must stay info / energy. It binds the lighting_state ` +
      "flag and the rule reads schedule_active and occupancy_state beside it (E2.4) — the " +
      "PARAMETER is the state and the window is the rule's, which is why " +
      "lit_while_unoccupied_min_day is deferred rather than authored. A zone burning with nobody " +
      "in it is a cost, not a failure: raising it to warning is how an operator learns to ignore " +
      `the panel at night. Got ${String(litWhileUnoccupied?.severity)} / ` +
      `${String(litWhileUnoccupied?.category)}.`,
  );
  assert(
    DEFERRED_DERIVED_CODES[LIGHTING_CODE].length === 5,
    `§1's Derived: line names five codes and all five are deferred — two windows ` +
      "(lit_while_unoccupied_min_day, override_hours_day) and three asset attributes " +
      `(lighting_w_per_m2, daylight_saving_pct, lamp_availability_pct). Got ` +
      `${DEFERRED_DERIVED_CODES[LIGHTING_CODE].length}.`,
  );

  // ---- 3 maintenance plans, one of them safetyCritical --------------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 3, `plan §5.10 authors 3 lighting plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 1 && safetyCritical[0]?.category === "safety_critical",
    "exactly one lighting plan is safetyCritical — the annual emergency-lighting DURATION test, " +
      "which is the one that proves the escape route stays lit for its rated period after a " +
      "supply failure. The monthly function test is an inspection round and the luminaire clean " +
      `is condition work. Got ${safetyCritical.length}: ` +
      `${safetyCritical.map((plan) => plan.title).join("; ") || "(none)"}`,
  );
  const conditionPlans = plans.filter((plan) => plan.category === "condition_based");
  assert(
    conditionPlans.length === 1 && conditionPlans[0]?.generationMode === "condition",
    `${LIGHTING_CODE} must carry exactly one condition_based plan, generated in "condition" mode ` +
      "— the luminaire clean and lamp/driver replacement. A condition_based plan on a calendar " +
      `mode is a calendar plan wearing the wrong category. Got ${conditionPlans.length} plan(s), ` +
      `mode "${String(conditionPlans[0]?.generationMode)}".`,
  );
  const trigger = String(conditionPlans[0]?.triggerSummary ?? "");
  for (const pointKey of ["lamp_fault_count", "illuminance_lux"]) {
    assert(
      trigger.includes(pointKey),
      `${LIGHTING_CODE}'s luminaire plan must name ${pointKey} in its triggerSummary — the two ` +
        "measured rows whose movement IS the trigger, and the two the lamp_fault_count_high and " +
        "illuminance_low_at_full_output alarms bind. A condition plan that does not say what " +
        `condition generates it is a calendar plan with a different word on it. Got: "${trigger}"`,
    );
  }
  assertMaintenanceBounds(LIGHTING_CODE, entry);
  assertProvenance(LIGHTING_CODE, entry, FACILITY_TAG_LIST, "§1");
}

// ===========================================================================
// §2 — `facility-fire-panel`
// ===========================================================================

const FIRE_PANEL_CODE = "facility-fire-panel";

/**
 * §2's 24 table rows in the document's own order (`sortOrder` 0-23) —
 * `[pointKey, tier, unit]`. Nothing is appended: §2 promotes no derived code.
 *
 * **Two rows are the ones this table exists to hold.** `smoke_state` at index 22
 * is a **reused** code — the control room's, referenced here and redeclared
 * nowhere (ADR 0054 decision 3), and its unit is the empty string the vocabulary
 * already seeds, spelled `null` here so the template defers to the catalog
 * rather than overriding it. `weekly_test_done` at index 23 is the entry's one
 * `M` row: entered by hand through `F1.8`, never mapped from a data key.
 *
 * Only two rows carry a unit — `bar` on the hydrant header and `%` on the fire
 * tank — and the other twenty-two are `0/1`, `enum` or `count` rows, which ADR
 * 0051 Amendment 6 decision 4 spells `""` in the vocabulary and `null` here.
 *
 * `panel_comms_ok` is **declared here**. §3's `controller_comms_ok` is a
 * different code on a different device and the two are not to be normalised into
 * one: this row is the link between the gateway and the FIRE panel, and the
 * alarm that binds it is the pack's only `critical` comms row.
 */
const FIRE_PANEL_POINTS: readonly PointRow[] = [
  ["fire_alarm_state", "core", null],
  ["fire_fault_state", "core", null],
  ["fire_supervisory_state", "extended", null],
  ["fire_isolate_state", "core", null],
  ["fire_prealarm_state", "extended", null],
  ["panel_ac_ok", "core", null],
  ["panel_battery_ok", "core", null],
  ["panel_earth_fault", "extended", null],
  ["panel_comms_ok", "core", null],
  ["zone_alarm_state", "core", null],
  ["zone_fault_state", "core", null],
  ["zone_isolated_state", "extended", null],
  ["active_alarm_count", "extended", null],
  ["active_fault_count", "extended", null],
  ["sounder_active", "extended", null],
  ["sounder_silenced", "extended", null],
  ["fire_pump_status", "extended", null],
  ["jockey_pump_status", "extended", null],
  ["hydrant_header_pressure_bar", "extended", "bar"],
  ["fire_tank_level_pct", "extended", "%"],
  ["sprinkler_flow_state", "extended", null],
  ["suppression_released_state", "extended", null],
  ["smoke_state", "extended", null],
  ["weekly_test_done", "manual", null],
];

/**
 * §2 authors **no** derived point, and the empty table is the claim.
 *
 * The pack's NEW deferral class is here: `fire_system_healthy` is expressible —
 * a product of five declared binaries that PARSES under `bms-calc-v1` — and it
 * is refused all the same, because a health flag over states is
 * `content.health`'s job (ADR 0050's surface) and each of its five inputs
 * already raises its own alarm. **Every other class in this pack is deferred
 * because it cannot be written; this one because it should not be** (plan §12
 * ruling 5). The other three are two time windows and a test schedule the panel
 * does not report.
 */
const FIRE_PANEL_DERIVED: readonly DerivedRow[] = [];

/**
 * §2's eleven alarm bullets become **eleven** rows, one for one — the only entry
 * in the pack where the mapping is exactly one to one.
 *
 * Ten are `safety`. `jockey_pump_cycling` is the exception and is `operations`:
 * a jockey pump starting repeatedly is a LEAK in the ring main, which is a
 * maintenance finding on the wet system rather than a life-safety event, and
 * filing it `safety` would put it beside the fire alarm on every screen that
 * groups by category.
 */
const FIRE_PANEL_ALARMS: readonly AlarmRow[] = [
  ["fire_alarm", "fire_alarm_state", "critical", "safety"],
  ["fire_fault", "fire_fault_state", "warning", "safety"],
  ["fire_supervisory", "fire_supervisory_state", "warning", "safety"],
  ["zone_isolated_too_long", "fire_isolate_state", "warning", "safety"],
  ["panel_on_battery", "panel_ac_ok", "warning", "safety"],
  ["panel_earth_fault", "panel_earth_fault", "warning", "safety"],
  ["panel_comms_loss", "panel_comms_ok", "critical", "safety"],
  ["fire_pump_running_unplanned", "fire_pump_status", "warning", "safety"],
  ["hydrant_header_pressure_low", "hydrant_header_pressure_bar", "critical", "safety"],
  ["fire_tank_level_low", "fire_tank_level_pct", "critical", "safety"],
  ["jockey_pump_cycling", "jockey_pump_status", "warning", "operations"],
];

/**
 * **The seven rows that carry no `skill`, and the four that do** (plan §12
 * ruling 4 — the distinction ADR 0054 decision 5 was reaching for).
 *
 * `bms.alarm_skills` holds five trades from migration `0034` — `electrical`,
 * `mechanical`, `hvac`, `controls`, `civil` — and **no fire, security or
 * life-safety trade**. The rule this entry establishes for the pack is: **a
 * trade answers the panel's own infrastructure; none of the five answers the
 * EVENT the panel reports.** A fire alarm, a detector fault, a supervisory
 * signal, an isolation left in place, an earth fault on loop wiring, a fire pump
 * running and a header pressure falling are all answered by the site's fire
 * function — so the field is omitted rather than routed to whichever trade a
 * form wanted a value from.
 *
 * The four that carry one are infrastructure a trade genuinely answers: the
 * panel's mains supply (`electrical`), the gateway link (`controls`), the fire
 * water tank and its make-up (`civil`) and the jockey pump (`mechanical`).
 *
 * **This is the largest no-skill block in the catalog** — seven of the pack's
 * fourteen PR 1 rows — and `F4.78` is the backlog row that files the missing
 * trades. When it lands, these seven gain a `skill` in a `stockVersion: 2`.
 */
const FIRE_PANEL_NO_SKILL_ROWS = [
  "fire_alarm",
  "fire_fault",
  "fire_supervisory",
  "zone_isolated_too_long",
  "panel_earth_fault",
  "fire_pump_running_unplanned",
  "hydrant_header_pressure_low",
] as const;

/**
 * **Observe-only, and it is a scope fence rather than an omission** (ADR 0054,
 * §2's own instruction: *"The BMS observes only"*).
 *
 * Reset, silence and isolate stay on the panel. A template cannot command
 * anything today — there is no command surface in `asset_templates.content` at
 * all — so this claim is about the CONTENT: no alarm and no maintenance plan may
 * instruct an operator to reset, silence or isolate from the BMS, because a
 * sentence telling somebody to silence a fire panel from a monitoring screen is
 * a sentence that will be believed the day one exists.
 *
 * `sounder_silenced` is a declared row and stays: the panel REPORTS that
 * somebody silenced it at the panel, which is exactly the observation this entry
 * exists for. The forbidden shape is an instruction, not an observation, so the
 * scan is over the imperative forms only.
 */
function assertObserveOnly(entry = requireStockEntry(FIRE_PANEL_CODE)): void {
  const forbidden = [/\breset the panel\b/i, /\bsilence the\b/i, /\bisolate the zone\b/i];
  const texts = [
    ...alarmsOf(entry).flatMap((alarm) => [
      String(alarm.message ?? ""),
      ...Object.values(
        (alarm.philosophy ?? {}) as Record<string, unknown>,
      ).map((value) => String(value)),
    ]),
    ...maintenanceOf(entry).map((plan) => String(plan.triggerSummary ?? "")),
  ];
  for (const text of texts) {
    for (const pattern of forbidden) {
      assert(
        !pattern.test(text),
        `${FIRE_PANEL_CODE} instructs an operator to reset, silence or isolate in "${text}". ` +
          "§2 and ADR 0054 make this entry OBSERVE-ONLY: those three actions stay on the panel, " +
          "with the person standing in front of it who can see the zone plan. The template has " +
          "no command surface today, so the instruction is all that could ship — and an " +
          "instruction to silence a fire panel from a monitoring screen is one somebody will " +
          "follow the day a command surface exists.",
      );
    }
  }
}

/**
 * `facility-fire-panel` against `docs/e5.3-derived-taglist-v1.md` §2 (plan §5.2)
 * — **the entry the pack's first escalation checkpoint keys on**, and the one
 * that sets the `skill` rule for everything after it.
 *
 * Three properties meet here for the first time in the pack: a reused code, an
 * `M` row, and an alarm set where the majority of rows deliberately carry no
 * trade. It is also where the no-number rule bites hardest — the state
 * vocabulary is a standard's and every window and level is a fire officer's.
 */
function checkFirePanel(): void {
  const entry = requireStockEntry(FIRE_PANEL_CODE);
  assertEntryIdentity(FIRE_PANEL_CODE, entry, "fire_panel", "facility");

  // ---- 24 points, 8 core + 15 extended + 1 manual + 0 derived -------------

  assert(
    tierCount(entry, "core") === 8 &&
      tierCount(entry, "extended") === 15 &&
      tierCount(entry, "manual") === 1 &&
      tierCount(entry, "derived") === 0,
    `§2 marks 8 rows C, 15 X and 1 M, and promotes none of its four derived codes — 8/15/1/0. ` +
      `Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(FIRE_PANEL_CODE, "§2", entry, FIRE_PANEL_POINTS);
  assertDerivedPoints(FIRE_PANEL_CODE, entry, FIRE_PANEL_DERIVED);
  assertNoKpis(FIRE_PANEL_CODE, entry, "§2");
  assertDeferralsAbsent(FIRE_PANEL_CODE, entry);

  // ---- the M row, and the reused code beside it ---------------------------

  const weeklyTest = entry.points.find((point) => point.pointKey === "weekly_test_done");
  assert(
    weeklyTest?.meta?.tier === "manual" &&
      weeklyTest.required === false &&
      weeklyTest.sourceDataKeyPattern === null,
    `${FIRE_PANEL_CODE}.weekly_test_done must be tier M, optional and carry a null ` +
      "sourceDataKeyPattern. §2 marks it M because the weekly test is a signature in a logbook, " +
      "not a telemetry point: it arrives through F1.8 manual entry and is never mapped from a " +
      "data key. An M row therefore never gets an asset_points row at all — it is always in " +
      `skippedPoints — and promoting it to C would make every import fail. Got tier ` +
      `${String(weeklyTest?.meta?.tier)}, required ${String(weeklyTest?.required)}, pattern ` +
      `${String(weeklyTest?.sourceDataKeyPattern)}.`,
  );
  const smoke = entry.points.find((point) => point.pointKey === "smoke_state");
  assert(
    smoke?.unit === null && smoke.meta?.tier === "extended",
    `${FIRE_PANEL_CODE}.smoke_state is a REUSED code — the control room's — referenced here and ` +
      "redeclared nowhere (ADR 0054 decision 3). Its unit is the empty string the vocabulary " +
      "already seeds and is write-once through the seed's COALESCE, so this row must carry null " +
      "and defer to the catalog rather than override it on every organization that imports the " +
      `entry. Got unit ${String(smoke?.unit)}, tier ${String(smoke?.meta?.tier)}.`,
  );

  // ---- 11 alarms, seven of them with no trade to route to ----------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(FIRE_PANEL_CODE, "§2", alarms, FIRE_PANEL_ALARMS);
  assertPhilosophyRows(FIRE_PANEL_CODE, alarms);
  assertSkillAssignment(
    FIRE_PANEL_CODE,
    alarms,
    {
      panel_on_battery: "electrical",
      panel_comms_loss: "controls",
      fire_tank_level_low: "civil",
      jockey_pump_cycling: "mechanical",
    },
    FIRE_PANEL_NO_SKILL_ROWS,
  );
  assert(
    FIRE_PANEL_NO_SKILL_ROWS.length === 7,
    `${FIRE_PANEL_CODE} must carry exactly seven rows with no skill — the events the panel ` +
      "REPORTS, whose responder is the site's fire function and not one of migration 0034's five " +
      "trades. The other four are the panel's own infrastructure: its mains supply (electrical), " +
      "its gateway link (controls), the fire water tank (civil) and the jockey pump (mechanical). " +
      `Got ${FIRE_PANEL_NO_SKILL_ROWS.length}.`,
  );
  assertNoLimitNumbers(
    FIRE_PANEL_CODE,
    alarms,
    ["fire_alarm", "hydrant_header_pressure_low", "fire_tank_level_low", "zone_isolated_too_long"],
    FACILITY_LIFE_SAFETY_REGIME,
  );
  assertObserveOnly(entry);

  const commsLoss = alarms.find((alarm) => alarm.code === "panel_comms_loss");
  assert(
    commsLoss?.severity === "critical",
    `${FIRE_PANEL_CODE}'s panel_comms_loss must be critical. It is the SILENT failure: with the ` +
      "gateway-panel link down the BMS reports no alarm, no fault and no supervisory signal, and " +
      "every other row on this entry goes quiet in exactly the way a healthy building looks. A " +
      "warning here would be a warning that the monitoring stopped monitoring. Got " +
      `${String(commsLoss?.severity)}.`,
  );
  const cycling = alarms.find((alarm) => alarm.code === "jockey_pump_cycling");
  assert(
    cycling?.pointKey === "jockey_pump_status" && cycling.category === "operations",
    `${FIRE_PANEL_CODE}'s jockey_pump_cycling must bind the RUN STATUS jockey_pump_status and be ` +
      "filed operations, not safety. jockey_starts_per_hour is deferred — bms-calc-v1 has " +
      "arithmetic and five functions and no state, so a per-hour rate is not expressible — so " +
      "the alarm binds the status and the RATE is the rule's to evaluate (E2.4). A jockey pump " +
      "starting repeatedly is a leak in the ring main, which is a finding on the wet system and " +
      `not a life-safety event. Got "${String(cycling?.pointKey)}" / ` +
      `${String(cycling?.category)}.`,
  );

  // ---- 4 maintenance plans, two safetyCritical, none condition_based ------

  const plans = maintenanceOf(entry);
  assert(plans.length === 4, `plan §5.10 authors 4 fire-panel plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 2 &&
      safetyCritical.every((plan) => plan.category === "safety_critical"),
    "exactly two fire-panel plans are safetyCritical, both also categorised safety_critical — the " +
      "panel standby battery test and the annual detector and zone functional test. The weekly " +
      "test is compliance work and the pump run test is an inspection round: both matter and " +
      "neither is the barrier that fails silently. ADR 0054 decision 8 names both of these. Got " +
      `${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join("; ") || "(none)"}`,
  );
  const annual = plans.find((plan) => plan.intervalDays === 365);
  assert(
    annual?.complianceRef === "NFPA 72 / IS 2189",
    `${FIRE_PANEL_CODE}'s annual functional test must carry complianceRef "NFPA 72 / IS 2189". ` +
      "The standard is what the test is done AGAINST, and complianceRef is the one field on this " +
      "entry where a standard's number belongs — it is a citation, not a limit, which is why the " +
      "alarm rows carry no digit at all and this field carries two. Got " +
      `"${String(annual?.complianceRef)}".`,
  );
  // NO condition_based plan, and that is authoring rather than omission: a fire
  // panel's four tasks are all calendar work fixed by the standard and the
  // site's schedule, and there is no measured row here whose rise generates a
  // work order. `fire_tank_level_low` is an alarm somebody answers now, not a
  // task a plan raises later (E5.2 §13 item 10 — assert the absence with its
  // reason, never leave it unclaimed).
  const conditionPlans = plans.filter((plan) => plan.category === "condition_based");
  assert(
    conditionPlans.length === 0 && plans.every((plan) => plan.generationMode === "calendar"),
    `${FIRE_PANEL_CODE} must carry NO condition_based plan and every plan in "calendar" mode — ` +
      "§5.10 authors a weekly alarm test, a standby battery test, an annual detector and zone " +
      "functional test and a weekly fire and jockey pump run test. All four are calendar work " +
      "whose interval a standard and the site's fire officer fix, and none of them is generated " +
      `by a reading. Got ${conditionPlans.length} condition_based plan(s), modes [` +
      `${plans.map((plan) => String(plan.generationMode)).join(", ")}].`,
  );
  assertMaintenanceBounds(FIRE_PANEL_CODE, entry);
  assertProvenance(FIRE_PANEL_CODE, entry, FACILITY_TAG_LIST, "§2");
}

/**
 * Every per-class block in this file. Called by `facility-classes.test.ts`, its
 * name-sibling wrapper. **§3, §4 and §5 live in `facility-classes-2.spec.ts`
 * and §6 and §7 in `-3`**, so no file in this directory approaches the §4.5 cap.
 */
export function runFacilityClassEntryTests(): void {
  checkLightingZone();
  checkFirePanel();
}
