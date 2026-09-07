import {
  alarmLifecycleState,
  alarmStateLabel,
  alarmStateSearchText,
  canAcknowledge,
  type AlarmLifecycleStamps,
} from "./alarm-state";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const T = "2026-09-06T10:00:00.000Z";

function stamps(acknowledgedAt: string | null, clearedAt: string | null): AlarmLifecycleStamps {
  return { acknowledgedAt, clearedAt };
}

/**
 * ADR 0057 decision 1 — the four states the SPA derives from the two stamps.
 *
 * The derivation is a *product* of two independent nullable columns, so all
 * four combinations are asserted rather than the three the current screen
 * happens to produce. `acknowledged` is the one that changed meaning: before
 * `F3.10` it was the closure, and now it is an annotation on an alarm that is
 * still active.
 */
export function runAlarmLifecycleStateTests(): void {
  assert(alarmLifecycleState(stamps(null, null)) === "active", "neither stamp is active");
  assert(
    alarmLifecycleState(stamps(T, null)) === "acknowledged",
    "acknowledged and uncleared is acknowledged, not closed",
  );
  assert(
    alarmLifecycleState(stamps(null, T)) === "cleared_unacknowledged",
    "cleared and unacknowledged is its own state",
  );
  assert(alarmLifecycleState(stamps(T, T)) === "closed", "both stamps is closed");
}

/**
 * The label strings, exactly.
 *
 * They are asserted verbatim because they are what an operator reads and what
 * the search text below is built from — a silent rewording would move both at
 * once and the render spec would still pass if it derived its expectations
 * from this function.
 */
export function runAlarmStateLabelTests(): void {
  assert(alarmStateLabel("active") === "Active", "active label");
  assert(alarmStateLabel("acknowledged") === "Acknowledged", "acknowledged label");
  assert(
    alarmStateLabel("cleared_unacknowledged") === "Cleared — unacknowledged",
    "cleared-unacknowledged label, em dash included",
  );
  assert(alarmStateLabel("closed") === "Closed", "closed label");
}

/**
 * `POST /alarms/:id/ack` filters on `acknowledged_at IS NULL` only
 * (`alarms.service.ts`), and the plan records that this is exactly right: a
 * cleared, unacknowledged alarm still accepts the press, and that press is the
 * transition to *closed*. The button therefore keys on the acknowledgement
 * stamp alone — offering it on a closed row, or hiding it on a cleared one,
 * would both disagree with the endpoint.
 */
export function runCanAcknowledgeTests(): void {
  assert(canAcknowledge(stamps(null, null)), "an active alarm can be acknowledged");
  assert(
    canAcknowledge(stamps(null, T)),
    "a cleared, unacknowledged alarm can still be acknowledged — that press closes it",
  );
  assert(!canAcknowledge(stamps(T, null)), "an acknowledged alarm cannot be acknowledged again");
  assert(!canAcknowledge(stamps(T, T)), "a closed alarm cannot be acknowledged again");
}

/**
 * The search text is the label plus the words an operator actually types, and
 * the two invariants below are what make it useful rather than decorative:
 * *"cleared" matches an alarm iff it carries a clear stamp*, and *"open"
 * matches an alarm iff it is on the active rail*.
 *
 * Asserting the invariant rather than four literal strings is deliberate. The
 * page's own render spec checks that searching `cleared` keeps the two cleared
 * rows; if that expectation were written against a hand-maintained synonym
 * table, both could drift together and stay green.
 */
export function runAlarmStateSearchTextTests(): void {
  const all: AlarmLifecycleStamps[] = [
    stamps(null, null),
    stamps(T, null),
    stamps(null, T),
    stamps(T, T),
  ];
  for (const alarm of all) {
    const text = alarmStateSearchText(alarm).toLowerCase();
    const label = alarmStateLabel(alarmLifecycleState(alarm)).toLowerCase();
    assert(text.includes(label), `the label must be searchable: ${label}`);
    assert(
      text.includes("cleared") === (alarm.clearedAt !== null),
      `"cleared" must match exactly the cleared alarms: ${text}`,
    );
    assert(
      text.includes("open") === (alarm.clearedAt === null && alarm.acknowledgedAt === null),
      `"open" must match only an alarm on the active rail: ${text}`,
    );
    assert(
      text.includes("unack") === (alarm.acknowledgedAt === null),
      `"unack" must match exactly the unacknowledged alarms: ${text}`,
    );
  }
}
