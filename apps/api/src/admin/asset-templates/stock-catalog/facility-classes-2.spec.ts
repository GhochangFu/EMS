import { FACILITY_AIR_QUALITY_REGIME, FACILITY_OCCUPANCY_REGIME, FACILITY_TAG_LIST } from "./facility-classes.spec";
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
 * `E5.3` pass C, the second of three transcription spec files — §3 (the access
 * door), §4 (the occupancy zone) and §5 (the parking level) of
 * `docs/e5.3-derived-taglist-v1.md`.
 *
 * **Three entries here and two in each of its siblings**, the split plan §4.5
 * fixed from `E5.1`'s own measurement: the AGENTS.md §4.5 pre-commit guard reads
 * a whole file, and `water-classes.spec.ts` reached 704 lines with two entries.
 * §1 and §2 are in `facility-classes.spec.ts` (Tasks 4 and 5), §6 and §7 in `-3`
 * (Tasks 9 and 10). **This file is created with the access-door block alone and
 * the other two append to it** — the runner at the foot is the seam, so each
 * task adds one `check…()` call and nothing else moves.
 *
 * **The three entries here are the pack's derived-point file.** §1 and §2
 * promote nothing; §3, §4 and §5 promote three points over two codes, and one of
 * those codes — `occupancy_pct` — is authored **twice with two different
 * formulas**, which is `E5.1`'s `recovery_pct` shape and is asserted from the
 * parking-level block, the second authoring.
 *
 * **Every helper is imported and nothing is restated.**
 * `stock-transcription.spec.ts` is pack-neutral; `FACILITY_TAG_LIST` and
 * `FACILITY_OCCUPANCY_REGIME` and `FACILITY_AIR_QUALITY_REGIME` are declared once in
 * `facility-classes.spec.ts`
 * and imported here, so the document name and the regime sentence have exactly
 * one spelling across the pack.
 *
 * **`facility-classes-2.test.ts` is this file's name-sibling wrapper** —
 * `tests/repo-invariants.test.ts` matches the pair by name, and a spec imported
 * from a differently-named wrapper still runs but is absent from coverage.
 */

// ===========================================================================
// §3 — `facility-access-door`
// ===========================================================================

const ACCESS_DOOR_CODE = "facility-access-door";

/**
 * §3's 16 table rows in the document's own order (`sortOrder` 0-15), then the
 * one promoted derived point at 16 — `[pointKey, tier, unit]`.
 *
 * **Only the derived row carries a unit.** All sixteen table rows are `0/1`,
 * `enum` or `count` in the document's Unit column, which ADR 0051 Amendment 6
 * decision 4 spells `""` in the vocabulary and this table spells `null` — a
 * template `unit` is an OVERRIDE, and an override of the catalog's own value
 * ships to every organization that imports the entry and cannot be corrected by
 * a later seed. `denied_ratio_pct` is a percentage and carries `%`.
 *
 * `controller_comms_ok` at index 6 is **declared here**, its first occurrence in
 * the document (ADR 0054 decision 3, first-occurrence-wins) — and it is the one
 * code PR 2 depends on PR 1 for: §8a's lift and §8b's escalator both reference
 * it and neither redeclares it. It is `core` because a door controller the
 * head-end cannot reach reports nothing at all, and every other row on this
 * entry goes quiet in the way a quiet door looks.
 *
 * `door_state` is **not** §7's `door_open_state`, which is the BAS gateway's own
 * ENCLOSURE door. The two are different devices and are deliberately not
 * normalised into one code (plan §4.2's near-miss list).
 */
const ACCESS_DOOR_POINTS: readonly PointRow[] = [
  ["door_state", "core", null],
  ["lock_state", "core", null],
  ["door_forced_state", "core", null],
  ["door_held_state", "core", null],
  ["door_mode", "extended", null],
  ["reader_ok", "extended", null],
  ["controller_comms_ok", "core", null],
  ["controller_tamper", "extended", null],
  ["controller_ac_ok", "extended", null],
  ["controller_battery_ok", "extended", null],
  ["access_granted_count", "extended", null],
  ["access_denied_count", "extended", null],
  ["rex_count", "extended", null],
  ["fire_release_state", "extended", null],
  ["lockdown_state", "extended", null],
  ["turnstile_status", "extended", null],
  ["denied_ratio_pct", "derived", "%"],
];

/**
 * §3 promotes **one** of its four derived codes — the pack's first formula.
 *
 * `denied_ratio_pct` is denied events over ALL events, not over the granted
 * ones: the denominator is the sum, so the result is a fraction of traffic and
 * cannot exceed a hundred. Both inputs are `X` interval counters over the same
 * reporting interval, which is what makes the ratio meaningful — a cumulative
 * counter over an interval one would be a rate wearing a ratio's name, and it is
 * why `traffic_per_hour` is deferred rather than authored beside this.
 *
 * `maxInputAgeSeconds` is `null`, the 300 s default: both counters come from the
 * same controller at the same scan rate. The pack's only two overrides are on
 * the IAQ node, whose outdoor reference may arrive from a weather API.
 *
 * A door with no traffic in the interval divides by zero and `evaluate.ts`
 * returns `non_finite` — no value, never a wrong one — so nothing here is
 * guarded or clamped.
 */
const ACCESS_DOOR_DERIVED: readonly DerivedRow[] = [
  [
    "denied_ratio_pct",
    "{access_denied_count} / ({access_granted_count} + {access_denied_count}) * 100",
    null,
  ],
];

/**
 * §3's seven alarm bullets, one row each — nothing is dropped and nothing is
 * invented on this entry.
 *
 * **Five of the seven carry no `skill`** and they are the security class (plan
 * §12 ruling 4): a forced door, a held door, an opened enclosure, a burst of
 * denied attempts and a fire release are answered by the security desk and the
 * fire function, and `bms.alarm_skills` holds electrical, mechanical, hvac,
 * controls and civil. The two that do carry one are the controller's own
 * infrastructure — its head-end link and its mains supply.
 *
 * `denied_burst` binds the **counter** and not the ratio: the ratio is high on a
 * quiet door with one refused badge, and the event security cares about is a
 * run of attempts. {@link assertDeniedRatioIsBoundByNothing} asserts both halves.
 */
const ACCESS_DOOR_ALARMS: readonly AlarmRow[] = [
  ["door_forced", "door_forced_state", "critical", "safety"],
  ["door_held", "door_held_state", "warning", "safety"],
  ["controller_comms_loss", "controller_comms_ok", "critical", "operations"],
  ["controller_tamper", "controller_tamper", "warning", "safety"],
  ["controller_on_battery", "controller_ac_ok", "warning", "operations"],
  ["denied_burst", "access_denied_count", "warning", "safety"],
  ["fire_release_active", "fire_release_state", "critical", "safety"],
];

/** The five §3 rows the security desk and the fire function answer, not a trade. */
const ACCESS_DOOR_NO_SKILL_ROWS = [
  "door_forced",
  "door_held",
  "controller_tamper",
  "denied_burst",
  "fire_release_active",
] as const;

/**
 * **The promoted point is bound by no alarm, and that is authoring rather than
 * an omission.**
 *
 * §3's *denied-events burst* bullet is an ATTEMPT PATTERN — a run of refused
 * badges in one interval — and the row that carries it is `access_denied_count`.
 * `denied_ratio_pct` is a different question: it is high on a quiet door where a
 * single contractor swiped an expired card, and low on a door under a sustained
 * attempt during a busy shift. Binding the burst to the ratio would page the
 * security desk for the first and stay silent for the second.
 *
 * So the ratio ships as a trend point with no alarm on it. Asserted rather than
 * left implicit, because "a derived point nobody alarms" is exactly what a later
 * author reads as an oversight and helpfully fills in.
 */
function assertDeniedRatioIsBoundByNothing(entry = requireStockEntry(ACCESS_DOOR_CODE)): void {
  const alarms = alarmsOf(entry);
  const onRatio = alarms.filter((alarm) => alarm.pointKey === "denied_ratio_pct");
  assert(
    onRatio.length === 0,
    `${ACCESS_DOOR_CODE} alarm "${onRatio[0]?.code}" binds denied_ratio_pct, and no alarm may. ` +
      "§3's denied-events bullet is an ATTEMPT PATTERN and its row is the COUNTER: the ratio is " +
      "high on a quiet door where one contractor swiped an expired card, and low on a door under " +
      "a sustained attempt during a busy shift. The ratio ships as a trend point with nothing " +
      "bound to it, on purpose.",
  );
  const burst = alarms.find((alarm) => alarm.code === "denied_burst");
  assert(
    burst?.pointKey === "access_denied_count",
    `${ACCESS_DOOR_CODE}'s denied_burst must bind access_denied_count, the interval counter — ` +
      `got "${String(burst?.pointKey)}". The window it accumulates over is the rule's to ` +
      "evaluate (E2.4) and the parameter is the count, which is the same reason " +
      "traffic_per_hour is deferred: bms-calc-v1 has arithmetic and five functions and no clock.",
  );
}

/**
 * **No credential, no card number, no person's name — counts and states only.**
 *
 * The tag list's §9.6 privacy boundary is the one line of §3 that is not about
 * points at all, and it is the line a well-meaning integrator breaks first: the
 * access system knows WHO opened the door, and the temptation to carry the last
 * cardholder onto the BMS screen is real. The template carries `rex_count`,
 * `access_granted_count` and `access_denied_count` and nothing that identifies a
 * person, and this assertion is what keeps a `stockVersion 2` from adding one.
 *
 * Checked over the point keys AND the labels, because a key called
 * `last_user_id` and a label reading *"Last cardholder"* are the same mistake.
 */
function assertNoIdentityRows(entry = requireStockEntry(ACCESS_DOOR_CODE)): void {
  const forbidden = [/\bcard\b/i, /\bcardholder\b/i, /\bcredential/i, /\bbadge\b/i, /\buser\b/i, /\bperson\b/i, /\bname\b/i];
  for (const point of entry.points) {
    for (const pattern of forbidden) {
      assert(
        !pattern.test(point.pointKey) && !pattern.test(String(point.label ?? "")),
        `${ACCESS_DOOR_CODE} point "${point.pointKey}" (${String(point.label)}) names a ` +
          "credential or a person. The tag list's §9.6 boundary is that NO credential or person " +
          "data crosses into telemetry: the access system keeps the who, and the BMS carries " +
          "event counts and door states. A cardholder on a monitoring screen is a data-protection " +
          "finding on a client's site, and it is not recoverable once a template has shipped it " +
          "to every organization that imported the entry.",
      );
    }
  }
}

/**
 * `facility-access-door` against `docs/e5.3-derived-taglist-v1.md` §3 (plan
 * §5.3) — **the pack's first promoted formula, and its first entry where the
 * majority of the alarm rows have no trade to route to.**
 *
 * It is also the entry PR 2 depends on: `controller_comms_ok` is declared here
 * and referenced by both vertical-transport classes, so this commit is what
 * makes their `assertPointKeysActive` pass on a branch cut from `main`.
 */
function checkAccessDoor(): void {
  const entry = requireStockEntry(ACCESS_DOOR_CODE);
  assertEntryIdentity(ACCESS_DOOR_CODE, entry, "access_door", "facility");

  // ---- 17 points, 5 core + 11 extended + 0 manual + 1 derived -------------

  assert(
    tierCount(entry, "core") === 5 &&
      tierCount(entry, "extended") === 11 &&
      tierCount(entry, "manual") === 0 &&
      tierCount(entry, "derived") === 1,
    `§3 marks 5 rows C and 11 X, has no M row, and one of its four derived codes is authored — ` +
      `5/11/0/1. Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(ACCESS_DOOR_CODE, "§3", entry, ACCESS_DOOR_POINTS);
  assertDerivedPoints(ACCESS_DOOR_CODE, entry, ACCESS_DOOR_DERIVED);
  assertNoKpis(ACCESS_DOOR_CODE, entry, "§3");
  assertDeferralsAbsent(ACCESS_DOOR_CODE, entry);
  assertNoIdentityRows(entry);

  // ---- controller_comms_ok is declared here, and PR 2 depends on it -------

  const comms = entry.points.find((point) => point.pointKey === "controller_comms_ok");
  assert(
    comms?.meta?.tier === "core" && comms.required === true,
    `${ACCESS_DOOR_CODE}.controller_comms_ok must be tier C and required. §3 is its FIRST ` +
      "occurrence in the document, so it is declared here and filed under facility (ADR 0054 " +
      "decision 3), and §8a's lift and §8b's escalator reference it in PR 2 rather than " +
      "redeclaring it — this entry is what makes their assertPointKeysActive pass on a branch " +
      "cut from main. Core because a controller the head-end cannot reach reports nothing at " +
      `all, and every other row here goes quiet the way a quiet door looks. Got tier ` +
      `${String(comms?.meta?.tier)}, required ${String(comms?.required)}.`,
  );

  // ---- 7 alarms, five of them with no trade to route to -------------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(ACCESS_DOOR_CODE, "§3", alarms, ACCESS_DOOR_ALARMS);
  assertPhilosophyRows(ACCESS_DOOR_CODE, alarms);
  assertSkillAssignment(
    ACCESS_DOOR_CODE,
    alarms,
    {
      controller_comms_loss: "controls",
      controller_on_battery: "electrical",
    },
    ACCESS_DOOR_NO_SKILL_ROWS,
  );
  assert(
    ACCESS_DOOR_NO_SKILL_ROWS.length === 5,
    `${ACCESS_DOOR_CODE} must carry exactly five rows with no skill — the SECURITY class (plan ` +
      "§12 ruling 4): a forced door, a held door, an opened enclosure, a burst of denied attempts " +
      "and a fire release. The security desk and the fire function answer all five, and neither " +
      "is one of migration 0034's five maintenance trades. The other two rows are the " +
      "controller's own infrastructure — its head-end link (controls) and its mains supply " +
      `(electrical). Got ${ACCESS_DOOR_NO_SKILL_ROWS.length}.`,
  );
  assertDeniedRatioIsBoundByNothing(entry);

  const forced = alarms.find((alarm) => alarm.code === "door_forced");
  const release = alarms.find((alarm) => alarm.code === "fire_release_active");
  assert(
    forced?.severity === "critical" && release?.severity === "critical",
    `${ACCESS_DOOR_CODE}'s door_forced and fire_release_active must both be critical — a door ` +
      "opened without a grant is an intrusion in progress, and a fire release has put every " +
      "controlled door on the floor into its free-egress state, which is the correct behaviour " +
      "and is also the moment the building has no access control at all. Got " +
      `${String(forced?.severity)} and ${String(release?.severity)}.`,
  );
  assert(
    DEFERRED_DERIVED_CODES[ACCESS_DOOR_CODE].length === 3,
    "§3's Derived: line names four codes: denied_ratio_pct is authored above and the other " +
      "three are deferred — two windows (door_open_minutes_day, traffic_per_hour) and one " +
      `roll-up (access_system_healthy, ADR 0050's content.health surface). Got ` +
      `${DEFERRED_DERIVED_CODES[ACCESS_DOOR_CODE].length}.`,
  );

  // ---- 3 maintenance plans, one of them safetyCritical --------------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 3, `plan §5.10 authors 3 access-door plans; the entry carries ${plans.length}`);
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 1 && safetyCritical[0]?.category === "safety_critical",
    "exactly one access-door plan is safetyCritical — the fire-release and REX functional test " +
      "(plan §12 ruling 6). It is the EGRESS path: a lock that does not release on the fire " +
      "input, or a request-to-exit that does not fire, traps people inside a controlled door in " +
      "the one condition the door was allowed to exist for. The hardware inspection and the " +
      `battery test are preventive work. Got ${safetyCritical.length}: ` +
      `${safetyCritical.map((plan) => plan.title).join("; ") || "(none)"}`,
  );
  const release_plan = plans.find((plan) => plan.safetyCritical === true);
  assert(
    String(release_plan?.triggerSummary ?? "").includes("fire_release_state"),
    `${ACCESS_DOOR_CODE}'s fire-release test must name fire_release_state in its triggerSummary ` +
      "— the row the test exercises and the row fire_release_active binds. Got: " +
      `"${String(release_plan?.triggerSummary)}"`,
  );
  // NO condition_based plan, and that is authoring rather than omission (E5.2
  // §13 item 10 — assert the absence with its reason). §3's three tasks are all
  // calendar work: door hardware wears on a schedule and not on a reading, and
  // the two counters that DO move are traffic, not condition. The one measured
  // row whose rise means wear is denied_ratio_pct, and a rising denial rate is a
  // credential or a reader problem the security desk answers now, not a work
  // order a plan raises in ninety days.
  const conditionPlans = plans.filter((plan) => plan.category === "condition_based");
  assert(
    conditionPlans.length === 0 && plans.every((plan) => plan.generationMode === "calendar"),
    `${ACCESS_DOOR_CODE} must carry NO condition_based plan and every plan in "calendar" mode. ` +
      "Door hardware, a backup battery and a fire-release test are all calendar work; the two " +
      "counters that move are traffic and not condition, and a rising denial rate is a reader or " +
      "credential problem answered now rather than a work order raised in ninety days. Got " +
      `${conditionPlans.length} condition_based plan(s), modes [` +
      `${plans.map((plan) => String(plan.generationMode)).join(", ")}].`,
  );
  assertMaintenanceBounds(ACCESS_DOOR_CODE, entry);
  assertProvenance(ACCESS_DOOR_CODE, entry, FACILITY_TAG_LIST, "§3");
}

// ===========================================================================
// §4 — `facility-occupancy-zone`
// ===========================================================================

const OCCUPANCY_CODE = "facility-occupancy-zone";

/**
 * §4's 10 table rows in the document's own order (`sortOrder` 0-9), then the one
 * promoted derived point at 10 — `[pointKey, tier, unit]`.
 *
 * **`occupancy_state` at index 0 is a REFERENCED code, not a declared one.** §1
 * is its first occurrence in the document, so it is declared on the lighting
 * zone and filed under `facility` (ADR 0054 decision 3), and this entry names it
 * without redeclaring it. **A tier is per ENTRY**: it is `core` on both, for two
 * different reasons — the lighting zone cannot run its control strategy without
 * presence, and a zone that counts people needs to know whether anyone is there.
 *
 * **Three codes are declared HERE for later sections to reference**:
 * `entry_count` and `exit_count`, which §5's parking level uses for vehicles
 * rather than people, and `sensor_battery_pct`, which §6's IAQ node reuses. One
 * code, one meaning, and the tier is free to differ.
 *
 * `occupancy_capacity` is the document's *(attribute-as-point)* row and is the
 * whole reason `occupancy_pct` is authorable here at all — the capacity is a
 * POINT the zone reports, so `bms-calc-v1` can name it. That is what plan §12
 * ruling 2 overturned in ADR 0054's sketch, which had assumed the capacity was
 * an asset attribute the grammar cannot read.
 */
const OCCUPANCY_POINTS: readonly PointRow[] = [
  ["occupancy_state", "core", null],
  ["occupancy_count", "extended", null],
  ["occupancy_capacity", "extended", null],
  ["entry_count", "extended", null],
  ["exit_count", "extended", null],
  ["desk_occupied_count", "extended", null],
  ["zone_temp_c", "core", "°C"],
  ["zone_rh_pct", "extended", "%"],
  ["zone_temp_sp_c", "extended", "°C"],
  ["sensor_battery_pct", "extended", "%"],
  ["occupancy_pct", "derived", "%"],
];

/**
 * §4 promotes **one** of its four derived codes — `occupancy_pct`, the FIRST of
 * its two authorings.
 *
 * Both inputs are `X`: a site that fits neither a counter nor a capacity gets no
 * value, which is correct. An empty zone divides by a zero capacity only if the
 * capacity was never commissioned, and `evaluate.ts` returns `non_finite` there
 * — no value, never a wrong one.
 *
 * `maxInputAgeSeconds` is `null`, the 300 s default: the count and the capacity
 * arrive from the same sensor gateway. The pack's only two overrides are on the
 * IAQ node.
 */
const OCCUPANCY_DERIVED: readonly DerivedRow[] = [
  ["occupancy_pct", "{occupancy_count} / {occupancy_capacity} * 100", null],
];

/**
 * §4's five alarm bullets become **four** rows, and the fifth is dropped and
 * recorded — {@link assertNoSensorOfflineRow} below.
 *
 * `occupancy_over_capacity` **binds the derived point**, which is shipped
 * behaviour and not a novelty: `recovery_low` binds `recovery_pct` on
 * `water-ro`. It is the only row here with no `skill` — a zone over its egress
 * capacity is answered by the people who manage the space and by the fire
 * strategy, not by one of migration `0034`'s five maintenance trades.
 */
const OCCUPANCY_ALARMS: readonly AlarmRow[] = [
  ["occupancy_over_capacity", "occupancy_pct", "critical", "safety"],
  ["counter_drift", "entry_count", "warning", "operations"],
  ["zone_temp_out_of_band_occupied", "zone_temp_c", "warning", "comfort"],
  ["sensor_battery_low", "sensor_battery_pct", "info", "operations"],
];

/**
 * **The second dropped bullet of the pack, asserted as an absence** (plan §12
 * ruling 6) — §1's was the first.
 *
 * §4's *Alarms* line names five events and this entry carries four. The fifth —
 * *sensor offline* — has **no point to bind**: §4's table carries no
 * `sensor_online` row, and §6's IAQ node is the section that does. ADR 0054
 * decision 3 files the vocabulary from the document's TABLE and not from its
 * prose, so no row was invented to give the bullet a home.
 *
 * The bullet is a **v2 redline candidate for the `F2.18` handout**. Unlike §1's
 * gateway-comms bullet, this one has a nearly-identical row one section away,
 * which makes it the more tempting of the two to rehome — and rehoming it would
 * bind an alarm to a key this template does not declare, which fails
 * `assertContentRefsResolve` at import time on a client's site.
 *
 * Both halves are asserted, because either alone is weak: no declared point key
 * may contain `online`, and no alarm may bind one.
 */
function assertNoSensorOfflineRow(entry = requireStockEntry(OCCUPANCY_CODE)): void {
  const onlinePoints = entry.points.filter((point) => point.pointKey.includes("online"));
  assert(
    onlinePoints.length === 0,
    `${OCCUPANCY_CODE} declares an online point (${onlinePoints.map((p) => p.pointKey).join(", ")}), ` +
      "and §4's table carries none. §4's fifth alarm bullet — sensor offline — has NO row to " +
      "bind, and sensor_online was deliberately NOT added here for it (plan §12 ruling 6): the " +
      "vocabulary is filed from the document's TABLE, not its prose. §6's IAQ node is the " +
      "section that declares sensor_online, and the bullet is a v2 redline for the F2.18 " +
      "handout. sensor_battery_low is the health row this entry DOES carry.",
  );
  const onlineAlarms = alarmsOf(entry).filter((alarm) => alarm.pointKey.includes("online"));
  assert(
    onlineAlarms.length === 0,
    `${OCCUPANCY_CODE} alarm "${onlineAlarms[0]?.code}" binds ${String(onlineAlarms[0]?.pointKey)}, ` +
      "which this entry does not declare. §4's sensor-offline bullet is DROPPED and recorded for " +
      "F2.18, not rehomed onto §6's key: an alarm on a point the template does not declare fails " +
      "assertContentRefsResolve at import, and this bullet is the more tempting of the pack's two " +
      "to rehome precisely because a nearly-identical row exists one section away.",
  );
}

/**
 * `facility-occupancy-zone` against `docs/e5.3-derived-taglist-v1.md` §4 (plan
 * §5.4) — the pack's smallest entry, and the one that carries the FIRST of
 * `occupancy_pct`'s two formulas.
 *
 * It is also the entry that supplies three codes to later sections —
 * `entry_count`, `exit_count` and `sensor_battery_pct` — while referencing §1's
 * `occupancy_state`, so it sits on both sides of the first-occurrence rule at
 * once.
 */
function checkOccupancyZone(): void {
  const entry = requireStockEntry(OCCUPANCY_CODE);
  assertEntryIdentity(OCCUPANCY_CODE, entry, "occupancy_zone", "facility");

  // ---- 11 points, 2 core + 8 extended + 0 manual + 1 derived --------------

  assert(
    tierCount(entry, "core") === 2 &&
      tierCount(entry, "extended") === 8 &&
      tierCount(entry, "manual") === 0 &&
      tierCount(entry, "derived") === 1,
    `§4 marks 2 rows C and 8 X, has no M row, and one of its four derived codes is authored — ` +
      `2/8/0/1. Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(OCCUPANCY_CODE, "§4", entry, OCCUPANCY_POINTS);
  assertDerivedPoints(OCCUPANCY_CODE, entry, OCCUPANCY_DERIVED);
  assertNoKpis(OCCUPANCY_CODE, entry, "§4");
  assertDeferralsAbsent(OCCUPANCY_CODE, entry);

  // ---- the capacity is a POINT, which is what makes the ratio authorable --

  const capacity = entry.points.find((point) => point.pointKey === "occupancy_capacity");
  assert(
    capacity?.kind === "measured" && capacity.meta?.tier === "extended",
    `${OCCUPANCY_CODE}.occupancy_capacity must be a measured extended row. §4 spells it ` +
      "attribute-as-point, and that is the whole reason occupancy_pct is authorable at all: the " +
      "capacity is a POINT the zone reports, so bms-calc-v1 can name it. ADR 0054 sketched this " +
      "code as attribute-deferred on the assumption that the capacity was an asset attribute the " +
      "grammar cannot read, and plan §12 ruling 2 overturned that on the document's own row. Got " +
      `kind ${String(capacity?.kind)}, tier ${String(capacity?.meta?.tier)}.`,
  );

  // ---- 4 alarms, one of them with no trade to route to --------------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(OCCUPANCY_CODE, "§4", alarms, OCCUPANCY_ALARMS);
  assertPhilosophyRows(OCCUPANCY_CODE, alarms);
  assertSkillAssignment(
    OCCUPANCY_CODE,
    alarms,
    {
      counter_drift: "controls",
      zone_temp_out_of_band_occupied: "hvac",
      sensor_battery_low: "controls",
    },
    // The one no-skill row here is the LIFE-SAFETY class: a zone over its egress
    // capacity is answered by whoever manages the space and by the fire
    // strategy, and none of 0034's five maintenance trades is either of them.
    // The other three are a sensor binding (controls), a comfort band (hvac) and
    // a battery round (controls).
    ["occupancy_over_capacity"],
  );
  assertNoLimitNumbers(
    OCCUPANCY_CODE,
    alarms,
    ["occupancy_over_capacity"],
    FACILITY_OCCUPANCY_REGIME,
  );
  assertNoSensorOfflineRow(entry);

  const overCapacity = alarms.find((alarm) => alarm.code === "occupancy_over_capacity");
  assert(
    overCapacity?.pointKey === "occupancy_pct" && overCapacity.severity === "critical",
    `${OCCUPANCY_CODE}'s occupancy_over_capacity must bind the DERIVED occupancy_pct and be ` +
      "critical. Binding the raw count instead would need the capacity to be known by whoever " +
      "sets the rule, which is exactly the number the derived point already divides by — and an " +
      "over-capacity zone is an egress question, which is why it pages. An alarm on a derived " +
      "point is shipped behaviour: recovery_low binds recovery_pct on water-ro. Got " +
      `"${String(overCapacity?.pointKey)}" / ${String(overCapacity?.severity)}.`,
  );
  const drift = alarms.find((alarm) => alarm.code === "counter_drift");
  assert(
    drift?.pointKey === "entry_count" && String(drift.message ?? "").includes("exit_count"),
    `${OCCUPANCY_CODE}'s counter_drift must bind entry_count and NAME exit_count in its message ` +
      "— the divergence is between the two and bms-calc-v1 cannot express a running difference, " +
      "so the alarm binds one counter and the rule reads the other beside it (E2.4). A message " +
      `that does not say which second row the rule needs is a rule nobody can write. Got ` +
      `"${String(drift?.pointKey)}", message "${String(drift?.message)}".`,
  );
  assert(
    DEFERRED_DERIVED_CODES[OCCUPANCY_CODE].length === 3,
    "§4's Derived: line names four codes: occupancy_pct is authored above and the other three " +
      "are deferred — a window (occupied_hours_day), an attribute (space_utilization_pct, which " +
      "needs the desk or room count and not the egress capacity) and another asset's meter " +
      `(conditioning_while_empty_kwh). Got ${DEFERRED_DERIVED_CODES[OCCUPANCY_CODE].length}.`,
  );

  // ---- 2 maintenance plans, none of them safetyCritical -------------------

  const plans = maintenanceOf(entry);
  assert(plans.length === 2, `plan §5.10 authors 2 occupancy plans; the entry carries ${plans.length}`);
  // NO safetyCritical plan, and that is authoring rather than omission (E5.2
  // §13 item 10). The egress question this entry raises is answered by the
  // occupancy_over_capacity ALARM, which fires now; a battery round and a
  // counter calibration are the tasks, and calling either one safety-critical
  // would flatten the distinction the fire panel's and the access door's plans
  // depend on.
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 0,
    `${OCCUPANCY_CODE} must carry NO safetyCritical plan. Its egress question is answered by the ` +
      "occupancy_over_capacity alarm, which fires now; the two plans are a battery round and a " +
      "counter calibration, and marking either critical would flatten the distinction the fire " +
      `panel's battery test and the access door's fire-release test depend on. Got ` +
      `${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join("; ")}`,
  );
  const calibration = plans.find((plan) => plan.category === "calibration");
  assert(
    calibration !== undefined,
    `${OCCUPANCY_CODE} must carry a calibration plan — the people-counter drift check. ` +
      "counter_drift is the alarm and this is the task that clears it; a counter nobody " +
      "recalibrates diverges further every interval and the alarm becomes permanent furniture.",
  );
  for (const pointKey of ["entry_count", "exit_count"]) {
    assert(
      String(calibration?.triggerSummary ?? "").includes(pointKey),
      `${OCCUPANCY_CODE}'s calibration plan must name ${pointKey} in its triggerSummary — the ` +
        "two counters whose divergence IS the drift, and the two counter_drift is written " +
        `around. Got: "${String(calibration?.triggerSummary)}"`,
    );
  }
  const conditionPlans = plans.filter((plan) => plan.category === "condition_based");
  assert(
    conditionPlans.length === 0 && plans.every((plan) => plan.generationMode === "calendar"),
    `${OCCUPANCY_CODE} must carry NO condition_based plan and both plans in "calendar" mode. A ` +
      "wireless battery is replaced on a round and a people counter is recalibrated on a " +
      "schedule; neither is generated by a reading, and sensor_battery_low is an alarm somebody " +
      `answers rather than a condition a plan watches. Got ${conditionPlans.length} ` +
      `condition_based plan(s), modes [${plans.map((plan) => String(plan.generationMode)).join(", ")}].`,
  );
  assertMaintenanceBounds(OCCUPANCY_CODE, entry);
  assertProvenance(OCCUPANCY_CODE, entry, FACILITY_TAG_LIST, "§4");
}

// ===========================================================================
// §5 — `facility-parking-level`
// ===========================================================================

const PARKING_CODE = "facility-parking-level";

/**
 * §5's 16 table rows in the document's own order (`sortOrder` 0-15), then the
 * second authoring of `occupancy_pct` at 16 — `[pointKey, tier, unit]`.
 *
 * **Four rows carry a unit** — `ppm` twice on the two basement gases, `kW` and
 * `kWh` on the EV charger cluster — and the other twelve are `0/1` or `count`
 * rows, which ADR 0051 Amendment 6 decision 4 spells `""` in the vocabulary and
 * `null` here.
 *
 * **`co_ppm` is `core` on this entry and `extended` on §6's IAQ node**, which is
 * the pack's dual-tier row and is settled by ADR 0054 decision 4 rather than
 * left to the reader: a basement carbon monoxide sensor IS the ventilation
 * interlock, and a level without one has no way to know it needs to run the
 * fans. On an air quality node the same code is one pollutant among nine.
 * {@link assertCoPpmTier} says it from both blocks, the way `effluent_cod_mgl`
 * is asserted on the STP and the ETP.
 *
 * **`entry_count` and `exit_count` are REFERENCED, not declared** — §4's
 * occupancy zone owns them, and here they count VEHICLES rather than people.
 * One code, one meaning: things that crossed the boundary inward, in the
 * interval.
 *
 * `no2_ppm` here and §6's `no2_ppb` are two quantities at two ranges — a
 * basement's diesel exhaust and an indoor node's trace measurement — and are
 * deliberately not normalised into one code (plan §4.2's near-miss list).
 */
const PARKING_POINTS: readonly PointRow[] = [
  ["bays_total", "core", null],
  ["bays_occupied", "core", null],
  ["bays_free", "core", null],
  ["ev_bays_free", "extended", null],
  ["entry_barrier_state", "extended", null],
  ["exit_barrier_state", "extended", null],
  ["barrier_fault", "extended", null],
  ["entry_count", "extended", null],
  ["exit_count", "extended", null],
  ["co_ppm", "core", "ppm"],
  ["no2_ppm", "extended", "ppm"],
  ["jet_fan_status", "core", null],
  ["jet_fan_fault", "extended", null],
  ["guidance_comms_ok", "extended", null],
  ["ev_charger_kw", "extended", "kW"],
  ["ev_charger_kwh_total", "extended", "kWh"],
  ["occupancy_pct", "derived", "%"],
];

/**
 * §5 promotes **one** of its five derived codes — `occupancy_pct`, the SECOND
 * of its two authorings.
 *
 * Both inputs are `C` here, unlike §4's, where both are `X`: a guidance system
 * that does not know its bay count or its occupied count is not a guidance
 * system. `maxInputAgeSeconds` is `null` — the bay sensors report on one
 * network at one rate.
 */
const PARKING_DERIVED: readonly DerivedRow[] = [
  ["occupancy_pct", "{bays_occupied} / {bays_total} * 100", null],
];

/**
 * §5's seven alarm bullets, one row each — nothing dropped and nothing invented.
 *
 * **`co_high` is `critical` / `safety` and is the life-safety one on this
 * entry**, which the section says outright: a basement fills with exhaust when
 * the ventilation stops, and carbon monoxide is the gas that kills before
 * anybody notices it. `no2_high` is the diesel marker beside it and is a
 * `warning`.
 *
 * `level_full` is the one row with no `skill` — see {@link PARKING_NO_SKILL_ROWS}.
 */
const PARKING_ALARMS: readonly AlarmRow[] = [
  ["co_high", "co_ppm", "critical", "safety"],
  ["no2_high", "no2_ppm", "warning", "safety"],
  ["jet_fan_fault", "jet_fan_fault", "warning", "operations"],
  ["level_full", "bays_free", "info", "operations"],
  ["barrier_fault", "barrier_fault", "warning", "operations"],
  ["guidance_network_offline", "guidance_comms_ok", "warning", "operations"],
  ["bay_count_inconsistent", "bays_occupied", "warning", "operations"],
];

/**
 * **The pack's one no-skill row that is neither life-safety nor security, and
 * it is recorded rather than forced into a class it does not fit.**
 *
 * `assertSkillAssignment`'s failure text names three unanswerable classes — the
 * water and mechanical packs' process chemistry, this pack's life-safety and
 * security events, and this pack's OCCUPANCY rows. `level_full` is the pack's
 * instance of that third class, so nothing here needs a fourth constant or a
 * local restatement: a car park with no free bays is a
 * FACT about how busy the building is, and no maintenance trade answers it
 * because nothing is broken. The car-park operator opens another level or turns
 * the entry sign; a wireman, a fitter, a controls engineer, a ventilation
 * engineer and a civil trade all have nothing to do.
 *
 * Filing it under `controls` to make the map tidy would route a full car park to
 * a trade that would then have to work out why it was called, which is the exact
 * failure the omission exists to prevent. The row is `info` for the same reason.
 */
const PARKING_NO_SKILL_ROWS = ["level_full"] as const;

/**
 * **`occupancy_pct` is ONE code authored on TWO entries with DIFFERENT formula
 * strings, and that is correct rather than a clash** — `E5.1`'s `recovery_pct`
 * shape, and plan §12 ruling 2's promotion.
 *
 * ADR 0051 Amendment 6 decision 5 rules one code, one *meaning* — and the
 * meaning is identical on both: *the fraction of a space's design capacity that
 * is in use*. Only the rows differ, because a zone counts people against a
 * commissioned capacity and a level counts vehicles against its bays. The code
 * is promoted **once** into `FACILITY_CLASS_POINT_KEYS` and authored **twice**.
 *
 * Asserted from this block rather than from §4's because this is the second
 * authoring — the one a reader arrives at already holding the first, and
 * therefore the one where the suspicion of a copy-paste bug lands.
 */
function assertOccupancyIsOneCodeTwoFormulas(): void {
  const formulaOn = (code: string): string | undefined =>
    requireStockEntry(code).points.find((point) => point.pointKey === "occupancy_pct")?.formula ??
    undefined;
  const zone = formulaOn(OCCUPANCY_CODE);
  const level = formulaOn(PARKING_CODE);
  assert(
    zone === "{occupancy_count} / {occupancy_capacity} * 100" &&
      level === "{bays_occupied} / {bays_total} * 100",
    "occupancy_pct must be authored on BOTH facility-occupancy-zone and facility-parking-level, " +
      `each over its own asset's rows. Got zone "${String(zone)}" and level "${String(level)}". ` +
      "One code, one MEANING (ADR 0051 Amendment 6 decision 5) — the fraction of a space's " +
      "design capacity that is in use — and two formulas, because a zone counts people against " +
      "a commissioned capacity and a level counts vehicles against its bays. This is not a clash " +
      'and must not be "fixed" by minting a second code.',
  );
  assert(
    zone !== level,
    "the two occupancy_pct formulas must differ — identical strings mean one of the two entries " +
      "was copied from the other and now computes the wrong space's occupancy",
  );
  for (const code of [OCCUPANCY_CODE, PARKING_CODE] as const) {
    assert(
      !DEFERRED_DERIVED_CODES[code].includes("occupancy_pct"),
      `${code} lists occupancy_pct as a deferral and it is AUTHORED there. A code cannot be both ` +
        "on one entry: the deferral record is a claim that the entry does not declare it, and " +
        "assertDeferralsAbsent would fail on the entry itself. It is deferred on neither.",
    );
  }
}

/**
 * **The pack's dual-tier row, asserted from BOTH blocks** — the
 * `effluent_cod_mgl` shape (`manual` on the STP, `extended` on the ETP), and the
 * reason it is parameterised rather than written twice.
 *
 * `co_ppm` is declared once, under `facility`, because §5 is its first
 * occurrence in the document (ADR 0054 decision 3). **A tier is per ENTRY**, and
 * ADR 0054 decision 4 rules this one: `core` on the parking level, because a
 * basement carbon monoxide sensor IS the ventilation interlock and a level
 * without one has no way to know it needs to run its fans; `extended` on §6's
 * IAQ node, where the same code is one pollutant among nine on an indoor comfort
 * sensor.
 *
 * **Each block asserts its own half**, and the failure message names the other
 * — so "normalising" the two into one tier fails on whichever entry was edited,
 * with the reason the disagreement is deliberate. Exported because §6's block
 * lives in `facility-classes-3.spec.ts`: a claim about a pair asserted from one
 * side only is half a claim, and each entry ships in its own commit.
 */
export function assertCoPpmTier(code: string, tier: "core" | "extended"): void {
  const point = requireStockEntry(code).points.find((row) => row.pointKey === "co_ppm");
  assert(
    point?.meta?.tier === tier && point.required === (tier === "core"),
    `${code} must file co_ppm as meta.tier "${tier}" with required ${String(tier === "core")}. ` +
      "This is the pack's DUAL-TIER row (ADR 0054 decision 4) and the disagreement between the " +
      "two entries is deliberate: on facility-parking-level the code is CORE, because a basement " +
      "carbon monoxide sensor is the ventilation interlock and a level without one cannot know " +
      "it needs to run its fans; on environment-iaq-node it is EXTENDED, one pollutant among " +
      "nine on an indoor comfort sensor. The code itself is declared once, under facility, " +
      `because §5 is its first occurrence in the document. Got tier ` +
      `"${String(point?.meta?.tier)}", required ${String(point?.required)}.`,
  );
  assert(
    point?.unit === "ppm",
    `${code}.co_ppm must carry unit "ppm" on both entries — a tier is per entry and a UNIT is ` +
      "not: UNIT_BY_KEY seeds it write-once through COALESCE, so a template that overrode it on " +
      `one of the two would ship a disagreement no later seed could correct. Got ` +
      `"${String(point?.unit)}".`,
  );
}

/**
 * `facility-parking-level` against `docs/e5.3-derived-taglist-v1.md` §5 (plan
 * §5.5) — the entry that carries the pack's dual-tier row and the second of
 * `occupancy_pct`'s two formulas.
 *
 * **Its `co_ppm` half of the dual-tier claim is asserted here and §6's from
 * `facility-classes-3.spec.ts`** — each entry ships in its own commit, so
 * neither block may reach into an entry the catalog has not got yet.
 */
function checkParkingLevel(): void {
  const entry = requireStockEntry(PARKING_CODE);
  assertEntryIdentity(PARKING_CODE, entry, "parking_level", "facility");

  // ---- 17 points, 5 core + 11 extended + 0 manual + 1 derived -------------

  assert(
    tierCount(entry, "core") === 5 &&
      tierCount(entry, "extended") === 11 &&
      tierCount(entry, "manual") === 0 &&
      tierCount(entry, "derived") === 1,
    `§5 marks 5 rows C and 11 X, has no M row, and one of its five derived codes is authored — ` +
      `5/11/0/1. Got ${tierCount(entry, "core")}/${tierCount(entry, "extended")}/` +
      `${tierCount(entry, "manual")}/${tierCount(entry, "derived")}`,
  );
  assertPointTable(PARKING_CODE, "§5", entry, PARKING_POINTS);
  assertDerivedPoints(PARKING_CODE, entry, PARKING_DERIVED);
  assertOccupancyIsOneCodeTwoFormulas();
  assertCoPpmTier(PARKING_CODE, "core");
  assertNoKpis(PARKING_CODE, entry, "§5");
  assertDeferralsAbsent(PARKING_CODE, entry);

  // ---- 7 alarms, one of them with no trade to route to --------------------

  const alarms = alarmsOf(entry);
  assertAlarmTable(PARKING_CODE, "§5", alarms, PARKING_ALARMS);
  assertPhilosophyRows(PARKING_CODE, alarms);
  assertSkillAssignment(
    PARKING_CODE,
    alarms,
    {
      co_high: "hvac",
      no2_high: "hvac",
      jet_fan_fault: "mechanical",
      barrier_fault: "mechanical",
      guidance_network_offline: "controls",
      bay_count_inconsistent: "controls",
    },
    PARKING_NO_SKILL_ROWS,
  );
  assertNoLimitNumbers(PARKING_CODE, alarms, ["co_high", "no2_high"], FACILITY_AIR_QUALITY_REGIME);

  assert(
    PARKING_NO_SKILL_ROWS.length === 1,
    `${PARKING_CODE} must carry exactly one row with no skill — level_full, which is a FACT ` +
      "about how busy the building is and not a failure any trade answers. The two gas rows are " +
      "ventilation (hvac), the fan and the barrier are machines (mechanical), and the bay " +
      "network and the count inconsistency are sensor bindings (controls). Got " +
      `${PARKING_NO_SKILL_ROWS.length}.`,
  );
  const co = alarms.find((alarm) => alarm.code === "co_high");
  assert(
    co?.severity === "critical" && co.category === "safety",
    `${PARKING_CODE}'s co_high must be critical / safety — §5 calls it the life-safety one ` +
      "outright. A basement fills with exhaust when the ventilation stops, and carbon monoxide " +
      "is the gas that kills before anybody notices it. Filing it as an operations warning " +
      `beside the fan fault is how it gets read as a ventilation nuisance. Got ` +
      `${String(co?.severity)} / ${String(co?.category)}.`,
  );
  const inconsistent = alarms.find((alarm) => alarm.code === "bay_count_inconsistent");
  const inconsistentText = String(inconsistent?.message ?? "");
  assert(
    inconsistent?.pointKey === "bays_occupied" &&
      inconsistentText.includes("bays_free") &&
      inconsistentText.includes("bays_total"),
    `${PARKING_CODE}'s bay_count_inconsistent must bind bays_occupied and NAME bays_free and ` +
      "bays_total in its message. The inconsistency is between three rows and bms-calc-v1 " +
      "expresses no equality, so the alarm binds one and the rule reads the other two beside it " +
      `(E2.4). Got "${String(inconsistent?.pointKey)}", message "${inconsistentText}".`,
  );
  assert(
    DEFERRED_DERIVED_CODES[PARKING_CODE].length === 4,
    "§5's Derived: line names five codes: occupancy_pct is authored above and the other four " +
      "are deferred — and they are the pack's only list that is all one class, four time " +
      "windows (turnover_per_day, avg_dwell_min, fan_hours_day, co_driven_fan_pct). Got " +
      `${DEFERRED_DERIVED_CODES[PARKING_CODE].length}.`,
  );

  // ---- 4 maintenance plans, one condition_based, none safetyCritical ------

  const plans = maintenanceOf(entry);
  assert(plans.length === 4, `plan §5.10 authors 4 parking plans; the entry carries ${plans.length}`);
  // NO safetyCritical plan, and that is authoring rather than omission (E5.2
  // §13 item 10). The gas calibration is the closest — it is what keeps the
  // life-safety co_high row honest — and it is `calibration` work on a
  // ventilation interlock rather than a statutory barrier test. ADR 0054
  // decision 8 names ten critical plans in the pack and none of them is here.
  const safetyCritical = plans.filter((plan) => plan.safetyCritical === true);
  assert(
    safetyCritical.length === 0,
    `${PARKING_CODE} must carry NO safetyCritical plan. The gas calibration is the closest — it ` +
      "is what keeps the life-safety co_high row honest — and it is calibration work on a " +
      "ventilation interlock, not a statutory barrier test. ADR 0054 decision 8 names ten " +
      `critical plans across the pack and none of them is on this entry. Got ` +
      `${safetyCritical.length}: ${safetyCritical.map((plan) => plan.title).join("; ")}`,
  );
  const calibration = plans.find((plan) => plan.category === "calibration");
  for (const pointKey of ["co_ppm", "no2_ppm"]) {
    assert(
      String(calibration?.triggerSummary ?? "").includes(pointKey),
      `${PARKING_CODE}'s gas calibration plan must name ${pointKey} in its triggerSummary — the ` +
        "two rows the calibration is done on, and the two whose alarms are the level's only " +
        `safety ones. Got: "${String(calibration?.triggerSummary)}"`,
    );
  }
  const conditionPlans = plans.filter((plan) => plan.category === "condition_based");
  assert(
    conditionPlans.length === 1 && conditionPlans[0]?.generationMode === "condition",
    `${PARKING_CODE} must carry exactly one condition_based plan, generated in "condition" mode ` +
      "— the bay-sensor network check, raised when the three bay counts stop agreeing. A " +
      `condition_based plan on a calendar mode is a calendar plan wearing the wrong category. ` +
      `Got ${conditionPlans.length} plan(s), mode "${String(conditionPlans[0]?.generationMode)}".`,
  );
  const trigger = String(conditionPlans[0]?.triggerSummary ?? "");
  for (const pointKey of ["bays_occupied", "bays_free", "bays_total"]) {
    assert(
      trigger.includes(pointKey),
      `${PARKING_CODE}'s bay-sensor plan must name ${pointKey} in its triggerSummary — the three ` +
        "rows whose disagreement IS the trigger, and the three bay_count_inconsistent is " +
        `written around. Got: "${trigger}"`,
    );
  }
  assertMaintenanceBounds(PARKING_CODE, entry);
  assertProvenance(PARKING_CODE, entry, FACILITY_TAG_LIST, "§5");
}

/**
 * Every per-class block in this file. Called by `facility-classes-2.test.ts`,
 * its name-sibling wrapper. **§1 and §2 live in `facility-classes.spec.ts` and
 * §6 and §7 in `-3`**, so no file in this directory approaches the §4.5 cap.
 */
export function runFacilityClassEntryTests2(): void {
  checkAccessDoor();
  checkOccupancyZone();
  checkParkingLevel();
}
