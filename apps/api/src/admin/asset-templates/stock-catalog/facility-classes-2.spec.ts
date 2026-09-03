import { FACILITY_TAG_LIST } from "./facility-classes.spec";
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
 * `FACILITY_LIFE_SAFETY_REGIME` are declared once in `facility-classes.spec.ts`
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

/**
 * Every per-class block in this file. Called by `facility-classes-2.test.ts`,
 * its name-sibling wrapper. **§1 and §2 live in `facility-classes.spec.ts` and
 * §6 and §7 in `-3`**, so no file in this directory approaches the §4.5 cap.
 */
export function runFacilityClassEntryTests2(): void {
  checkAccessDoor();
}
