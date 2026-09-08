import { buildDedupeKey } from "../notifications/dedupe-key";
import {
  DEFAULT_CLEAR_HOLD_SECONDS,
  LIFECYCLE_TICK_MS,
  type LifecycleAlarm,
  type LifecycleRule,
  clearedDispatchInput,
  decideClear,
  dueSteps,
  escalationDispatchInput,
  escalationKey,
  raiseRetryDispatchInput,
} from "./alarm-lifecycle";

/**
 * `F3.10` U7 — the alarm lifecycle's decisions at fixed instants (ADR 0057
 * decisions 3, 5, 6 and plan D12/D14). Assertions live here; the sibling
 * `.test` is the Vitest entry point (ADR 0014). Nothing below touches a
 * database or a clock: `now` is an argument everywhere, so the 120 s hold and
 * the step offsets are asserted at the second, not whenever CI happens to run.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NOW = new Date("2026-09-06T12:00:00.000Z");

function secondsBefore(seconds: number, from: Date = NOW): Date {
  return new Date(from.getTime() - seconds * 1000);
}

function secondsAfter(seconds: number, from: Date = NOW): Date {
  return new Date(from.getTime() + seconds * 1000);
}

const alarm: LifecycleAlarm = {
  id: "alarm-1",
  organizationId: "org-asset",
  assetId: "asset-1",
  ruleId: "rule-1",
  // The ALARM's severity, deliberately different from the rule's below: the
  // event key must be built from what `bms.alarms.severity` holds.
  severity: "critical",
  message: "Feeder overload: kw = 150 (gt 100)",
  raisedAt: secondsBefore(125),
  acknowledgedAt: null,
  normalSince: null,
};

const rule: LifecycleRule = {
  id: "rule-1",
  code: "RULE-1",
  organizationId: "org-rule",
  severity: "warning",
};

function testConstants(): void {
  assert(LIFECYCLE_TICK_MS === 30_000, `decision 4: a 30 s tick, got ${LIFECYCLE_TICK_MS}`);
  assert(
    DEFAULT_CLEAR_HOLD_SECONDS === 120,
    `decision 3: a 120 s default hold, got ${DEFAULT_CLEAR_HOLD_SECONDS}`,
  );
}

/** The matrix in plan §4 U7, one row per line. */
function testDecideClearMatrix(): void {
  // Stale or no sample: no change, whatever the stamps say (ADR 0027).
  assert(
    decideClear({ matched: null, normalSince: null, clearHoldSeconds: null, now: NOW }) === null,
    "stale with no stamp: no write",
  );
  assert(
    decideClear({
      matched: null,
      normalSince: secondsBefore(600),
      clearHoldSeconds: null,
      now: NOW,
    }) === null,
    "stale with a stamp: no write — stale telemetry never clears",
  );

  // Matching again: the stamp is reset only if there is one to reset.
  const reset = decideClear({
    matched: true,
    normalSince: secondsBefore(30),
    clearHoldSeconds: null,
    now: NOW,
  });
  assert(
    reset !== null && reset.normalSince === null && reset.clearedAt === null,
    `matching with a stamp resets it, got ${JSON.stringify(reset)}`,
  );
  assert(
    decideClear({ matched: true, normalSince: null, clearHoldSeconds: null, now: NOW }) === null,
    "matching with no stamp: nothing to write",
  );

  // First non-matching sample: the stamp is set to the tick's own now.
  const started = decideClear({
    matched: false,
    normalSince: null,
    clearHoldSeconds: null,
    now: NOW,
  });
  assert(
    started !== null && started.normalSince === NOW && started.clearedAt === null,
    `non-matching with no stamp starts the hold at now, got ${JSON.stringify(started)}`,
  );

  // The hold has not elapsed: no write at all, not even a re-stamp.
  assert(
    decideClear({
      matched: false,
      normalSince: secondsBefore(119),
      clearHoldSeconds: null,
      now: NOW,
    }) === null,
    "119 s into a 120 s hold: no write",
  );

  // Exactly the hold: cleared, and the stamp is kept as the record of when
  // the condition went normal.
  const since = secondsBefore(120);
  const cleared = decideClear({
    matched: false,
    normalSince: since,
    clearHoldSeconds: null,
    now: NOW,
  });
  assert(
    cleared !== null && cleared.clearedAt === NOW && cleared.normalSince === since,
    `120 s into the default hold clears at now and keeps the stamp, got ${JSON.stringify(cleared)}`,
  );

  // A rule's own hold replaces the default in both directions.
  const shortHold = decideClear({
    matched: false,
    normalSince: secondsBefore(30),
    clearHoldSeconds: 30,
    now: NOW,
  });
  assert(shortHold?.clearedAt === NOW, "a 30 s hold clears after 30 s");
  assert(
    decideClear({
      matched: false,
      normalSince: secondsBefore(120),
      clearHoldSeconds: 300,
      now: NOW,
    }) === null,
    "a 300 s hold is not satisfied by 120 s",
  );
}

function testDueSteps(): void {
  const steps = [
    { stepNo: 1, afterMinutes: 1 },
    { stepNo: 2, afterMinutes: 5 },
  ];
  const raised = NOW;
  assert(
    dueSteps(steps, raised, secondsAfter(61)).join(",") === "1",
    `at +61 s only step 1 is due, got [${dueSteps(steps, raised, secondsAfter(61)).join(",")}]`,
  );
  assert(
    dueSteps(steps, raised, secondsAfter(301)).join(",") === "1,2",
    `at +301 s both steps are due, got [${dueSteps(steps, raised, secondsAfter(301)).join(",")}]`,
  );
  assert(
    dueSteps(steps, raised, secondsAfter(59)).length === 0,
    "at +59 s nothing is due",
  );
  assert(
    dueSteps(steps, raised, secondsAfter(60)).join(",") === "1",
    "exactly `after_minutes` counts as due — the tick is 30 s, so a strict bound would slip a whole step",
  );
  // Ascending by step number whatever order the catalogue handed them in.
  assert(
    dueSteps([steps[1] as (typeof steps)[number], steps[0] as (typeof steps)[number]], raised, secondsAfter(600)).join(
      ",",
    ) === "1,2",
    "due steps come back in step order",
  );
  assert(dueSteps([], raised, secondsAfter(600)).length === 0, "no steps, nothing due");
}

/** Plan D12 and D14, and the `U7 must guarantee` block from PR 1's review. */
function testEscalationDispatchInput(): void {
  const input = escalationDispatchInput(alarm, rule, 1, NOW);
  assert(input !== null, "a rule with an organization yields an input");
  if (input === null) return;
  assert(input.ruleId === "rule-1" && input.ruleCode === "RULE-1", "the rule's id and code");
  assert(
    input.organizationId === "org-rule",
    `D12: the RULE's organization, got ${input.organizationId}`,
  );
  assert(input.alarmId === "alarm-1", "the alarm id, never null");
  assert(
    input.severity === "critical",
    `the ALARM's severity, never the rule's, got ${String(input.severity)}`,
  );
  assert(input.raised === true, "an event is dispatched as a transition");
  assert(
    input.event?.kind === "escalation" && input.event.step === 1,
    `event { kind: "escalation", step: 1 }, got ${JSON.stringify(input.event)}`,
  );
  assert(
    input.message ===
      "Feeder overload: kw = 150 (gt 100) — unacknowledged for 2 min (escalation step 1)",
    `D14 body, got "${input.message}"`,
  );
  // Whole minutes, floored: 125 s is 2 min, not 2.08 and not 3.
  const later = escalationDispatchInput(alarm, rule, 2, secondsAfter(60));
  assert(
    later?.message.includes("unacknowledged for 3 min (escalation step 2)") === true,
    `minutes are floored from raisedAt, got "${String(later?.message)}"`,
  );

  assert(
    escalationDispatchInput(alarm, { ...rule, organizationId: null }, 1, NOW) === null,
    "a rule with no organization yields null — the caller warns and skips",
  );
}

function testClearedDispatchInput(): void {
  const input = clearedDispatchInput(alarm, rule);
  assert(input !== null, "a rule with an organization yields an input");
  if (input === null) return;
  assert(input.organizationId === "org-rule", "D12: the rule's organization");
  assert(input.alarmId === "alarm-1", "the alarm id, never null");
  assert(input.severity === "critical", "the alarm's severity");
  assert(input.raised === true, "an event is dispatched as a transition");
  assert(input.event?.kind === "cleared", `event { kind: "cleared" }, got ${JSON.stringify(input.event)}`);
  assert(
    input.message === "Cleared: Feeder overload: kw = 150 (gt 100)",
    `D14 body, got "${input.message}"`,
  );
  assert(
    clearedDispatchInput(alarm, { ...rule, organizationId: null }) === null,
    "a rule with no organization yields null",
  );
}

/**
 * `F3.51` — the re-offered raise's input (ADR 0041 Amendment 5, ADR 0057
 * Amendment 5). The identity of this input with the ORIGINAL raise's is the
 * whole mechanism, so every field is asserted rather than sampled.
 */
function testRaiseRetryDispatchInput(): void {
  const input = raiseRetryDispatchInput(alarm, rule);
  assert(input !== null, "a rule with an organization yields an input");
  if (input === null) return;
  assert(input.ruleId === "rule-1" && input.ruleCode === "RULE-1", "the rule's id and code");
  assert(
    input.organizationId === "org-rule",
    `D12: the RULE's organization, as toDispatchInput stamped the original, got ${input.organizationId}`,
  );
  assert(input.alarmId === "alarm-1", "the alarm id, never null");
  assert(
    input.severity === "critical",
    `the ALARM's severity, never the rule's: a rule edited mid-alarm would otherwise change the key and orphan the very rows the ledger read matched on; got ${String(input.severity)}`,
  );
  assert(
    input.message === "Feeder overload: kw = 150 (gt 100)",
    `the alarm's message VERBATIM — no prefix, no age, no staleness marker (F3.52 inherits that complaint); got "${input.message}"`,
  );
  // `raised: true` is load-bearing and is asserted rather than assumed. With
  // `event: undefined` a `raised: false` input falls into `dispatchToChannel`
  // step 1's transition dedupe, which writes a `skipped_deduped` row UNDER THE
  // RAISE KEY — and `channelsOwedTheRaise`'s `some(status !== "failed")` arm
  // would then block that key for the life of the alarm.
  assert(input.raised === true, "raised: true — this is the alarm's own raise, re-offered");
  assert(
    input.event === undefined,
    `no event: an event kind would append a suffix to the key and orphan the rows, got ${JSON.stringify(input.event)}`,
  );
  assert(input.reoffered === true, "reoffered: true — the property offeredAgainWithoutAsking reads");

  // The key identity, against the literal form the ledger holds, not only
  // against a second call of the same builder.
  assert(
    buildDedupeKey(input) === `${rule.id}:${alarm.id}:${alarm.severity}`,
    `the ORIGINAL raise's key, rule:alarm:severity, got "${buildDedupeKey(input)}"`,
  );
  assert(
    buildDedupeKey(input) ===
      buildDedupeKey({
        ruleId: rule.id,
        alarmId: alarm.id,
        severity: alarm.severity,
        // How `toDispatchInput` builds it on the raise path: no event.
      }),
    "and it equals the key the raise path's own input produces",
  );

  assert(
    raiseRetryDispatchInput(alarm, { ...rule, organizationId: null }) === null,
    "a rule with no organization yields null — the caller warns and skips",
  );
}

function testEscalationKey(): void {
  assert(
    escalationKey("org-1", "warning") === "org-1:warning",
    `the catalogue key is organization then severity, got ${escalationKey("org-1", "warning")}`,
  );
}

export function runAlarmLifecycleTests(): void {
  testConstants();
  testDecideClearMatrix();
  testDueSteps();
  testEscalationDispatchInput();
  testClearedDispatchInput();
  testRaiseRetryDispatchInput();
  testEscalationKey();
}
