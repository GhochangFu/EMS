/**
 * The four alarm lifecycle states the SPA derives — ADR 0057 decision 1.
 *
 * `bms.alarms` carries two independent stamps since `F3.10`: `acknowledged_at`
 * (a human has seen it) and `cleared_at` (the condition returned to normal and
 * held there for the rule's hold). **Active means `cleared_at IS NULL`.**
 * Acknowledgement is an annotation, not a closure — the ISA-18.2 lifecycle the
 * owner ruled for.
 *
 * That is a reversal of what this screen meant before the row, which is why
 * the derivation lives here rather than as a ternary in each of the two places
 * that render it. `alarms-page.tsx` had `acknowledgedAt ? … : "Open"` and
 * `alarm-details-panel.tsx` had the same expression, and under the new column
 * both were wrong in the same two ways: they called an acknowledged alarm
 * closed while its breach still held, and they called a cleared alarm open.
 *
 * `AlarmLifecycleState` is deliberately **not** a `@bms/shared` contract type.
 * Nothing crosses the wire in this shape — the API sends the two stamps and
 * the client derives; a contract enum would have to be kept in step with a
 * derivation the server never performs.
 */
export type AlarmLifecycleState =
  | "active"
  | "acknowledged"
  | "cleared_unacknowledged"
  | "closed";

/**
 * The two columns the derivation reads, structurally.
 *
 * Typed as its own shape rather than `AlarmListItem` so the details panel —
 * whose payload is `AlarmDetailsResponse`, a different contract carrying the
 * same two keys — uses the identical helper. Two copies of a lifecycle rule is
 * how the two screens disagreed in the first place.
 */
export type AlarmLifecycleStamps = {
  acknowledgedAt: string | null;
  clearedAt: string | null;
};

/** Which of the four states an alarm is in (decision 1). */
export function alarmLifecycleState(alarm: AlarmLifecycleStamps): AlarmLifecycleState {
  if (alarm.clearedAt === null) {
    return alarm.acknowledgedAt === null ? "active" : "acknowledged";
  }
  return alarm.acknowledgedAt === null ? "cleared_unacknowledged" : "closed";
}

/** What the operator reads in the State column. */
export function alarmStateLabel(state: AlarmLifecycleState): string {
  if (state === "active") {
    return "Active";
  }
  if (state === "acknowledged") {
    return "Acknowledged";
  }
  if (state === "cleared_unacknowledged") {
    return "Cleared — unacknowledged";
  }
  return "Closed";
}

/**
 * Whether the Ack button belongs on this row.
 *
 * `POST /api/v1/alarms/:id/ack` filters on `acknowledged_at IS NULL` and
 * nothing else, and ADR 0057 decision 1 keeps it that way: a *cleared,
 * unacknowledged* alarm still accepts the press, and that press is the
 * transition to *closed*. So the button follows the endpoint's own predicate
 * — it appears on an active row and on a cleared-unacknowledged one, and on
 * neither of the two acknowledged states.
 */
export function canAcknowledge(alarm: Pick<AlarmLifecycleStamps, "acknowledgedAt">): boolean {
  return alarm.acknowledgedAt === null;
}

/**
 * The state's contribution to the alarm grid's free-text search.
 *
 * The label alone is not enough and the previous code knew it: `:61` searched
 * `"open active unack"` for an unacknowledged alarm, because those are the
 * words an operator types. Two invariants hold, and `alarm-state.spec.ts`
 * asserts them as invariants rather than as four literal strings:
 *
 * - **"cleared" matches an alarm iff it carries a clear stamp** — so a search
 *   for `cleared` returns the cleared-unacknowledged rows *and* the closed
 *   ones, which is the only reading of the word that is true of both.
 * - **"open" matches an alarm iff it is on the active rail** — unacknowledged
 *   and uncleared. Under decision 1 a cleared alarm has left that rail, so it
 *   loses the term it used to carry.
 */
export function alarmStateSearchText(alarm: AlarmLifecycleStamps): string {
  const label = alarmStateLabel(alarmLifecycleState(alarm));
  const terms: string[] = [label];
  if (alarm.clearedAt === null) {
    if (alarm.acknowledgedAt === null) {
      terms.push("open");
    }
  } else {
    terms.push("cleared");
  }
  terms.push(alarm.acknowledgedAt === null ? "unack" : "ack");
  return terms.join(" ");
}
