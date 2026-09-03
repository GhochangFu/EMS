import { DEFERRED_DERIVED_CODES } from "./stock-catalog-deferrals.spec";
import { alarmsOf, assert, maintenanceOf, requireStockEntry } from "./stock-catalog.spec";
import {
  assertAlarmTable,
  assertDeferralsAbsent,
  assertDerivedPoints,
  assertEntryIdentity,
  assertMaintenanceBounds,
  assertNoKpis,
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

/**
 * Every per-class block in this file. Called by `facility-classes.test.ts`, its
 * name-sibling wrapper. **§3, §4 and §5 live in `facility-classes-2.spec.ts`
 * and §6 and §7 in `-3`**, so no file in this directory approaches the §4.5 cap.
 */
export function runFacilityClassEntryTests(): void {
  checkLightingZone();
}
