import type { NotificationDeliveryEvent } from "@bms/shared";

import { buildDedupeKey, parseDeliveryEvent, type DispatchEvent } from "./dedupe-key";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const RULE_ID = "11111111-1111-1111-1111-111111111111";
const ALARM_ID = "22222222-2222-2222-2222-222222222222";

/**
 * `F3.10` U2 — the dedupe key's encoding (ADR 0041 decision 7; ADR 0057
 * decision 9).
 *
 * The key is what decision 10's idempotency rests on: an escalation step or a
 * cleared message is sent once per `(channel, organization, key)`, and the
 * only thing that tells step 1 from step 2, or a step from the raise, is the
 * suffix this file asserts. A key that collapsed two events into one string
 * would make the second silently unsendable; a key that differed between two
 * ticks would make it send twice.
 */
export function runDedupeKeyTests(): void {
  const raise = { ruleId: RULE_ID, alarmId: ALARM_ID, severity: "warning" };
  const raiseKey = buildDedupeKey(raise);

  // --- no event: the `F3.8` key, byte for byte --------------------------------
  //
  // The raise path passes no `event`, so this is the key every existing ledger
  // row holds. Changing it would orphan every `F3.46` skip row already written.
  assert(
    raiseKey === `${RULE_ID}:${ALARM_ID}:warning`,
    `the raise key is rule:alarm:severity, got ${raiseKey}`,
  );
  assert(
    buildDedupeKey({ ruleId: RULE_ID, alarmId: null, severity: null }) ===
      `${RULE_ID}:no-alarm:no-severity`,
    "a missing alarm and severity keep their placeholders",
  );
  assert(
    buildDedupeKey({ ...raise, event: undefined }) === raiseKey,
    "an explicit `event: undefined` is the raise key too",
  );

  // --- an escalation step carries its number -------------------------------
  const step2 = buildDedupeKey({ ...raise, event: { kind: "escalation", step: 2 } });
  assert(step2 === `${raiseKey}:escalation:2`, `step 2 appends :escalation:2, got ${step2}`);
  assert(
    buildDedupeKey({ ...raise, event: { kind: "escalation", step: 1 } }) !== step2,
    "two steps of one alarm are two keys — the second must not be answered from the first",
  );
  assert(
    buildDedupeKey({ ...raise, event: { kind: "escalation", step: 2 } }) === step2,
    "the same step on the next tick keys the same — that is what makes it sendable once",
  );

  // --- cleared ---------------------------------------------------------------
  const cleared = buildDedupeKey({ ...raise, event: { kind: "cleared" } });
  assert(cleared === `${raiseKey}:cleared`, `cleared appends :cleared, got ${cleared}`);

  // --- an event key is never the raise key -----------------------------------
  //
  // The raise row for this alarm is already in the ledger when the sweep asks
  // about a step; if an event key could equal it, every step would look
  // already sent.
  const events: DispatchEvent[] = [{ kind: "escalation", step: 1 }, { kind: "cleared" }];
  for (const event of events) {
    const key = buildDedupeKey({ ...raise, event });
    assert(key !== raiseKey, `the ${event.kind} key must differ from the raise key`);
    assert(key.startsWith(`${raiseKey}:`), `the ${event.kind} key extends the raise key`);
  }

  // --- the column width still bounds it --------------------------------------
  //
  // `dedupe_key varchar(255)`. Two uuids, a severity and the longest suffix are
  // far short of it; the clamp is for the rule id nobody predicted.
  const long = buildDedupeKey({
    ruleId: "x".repeat(400),
    alarmId: ALARM_ID,
    severity: "critical",
    event: { kind: "escalation", step: 10 },
  });
  assert(long.length <= 255, `the key is clamped to the column width, got ${long.length}`);
}

// ---------------------------------------------------------------------------
// `F3.56` — reading the kind back out of the key (ADR 0041 Amendment 8)
// ---------------------------------------------------------------------------

/** A second rule, so a key built for `RULE_ID` can be offered to a row that is not its own. */
const OTHER_RULE_ID = "33333333-3333-3333-3333-333333333333";

/** One `buildDedupeKey` input, the row it belongs to, and the kind it must read back as. */
type RoundTripCase = {
  readonly what: string;
  readonly input: {
    ruleId: string;
    alarmId: string | null;
    severity: string | null;
    event?: DispatchEvent;
  };
  readonly expected: NotificationDeliveryEvent;
};

/**
 * `F3.56` E1 — every shape `buildDedupeKey` writes reads back as its own kind.
 *
 * **This is a round trip, and that is the reason the parse lives in this file.**
 * Amendment 8 puts `parseDeliveryEvent` beside the writer rather than in the
 * service, because a format read in a second module is a claim about a file the
 * reader never opens. Here the key under test is produced by the real writer on
 * every row, so a change to either half that the other does not follow is red.
 *
 * The rows are ORDERED for AGENTS.md §4.6: `assert` throws, so only the first
 * failing row prints, and each of the three mutations below has to reach a row
 * no earlier one already covers.
 *
 * - the `:cleared` branch returning `raise` → **row 7**
 * - the escalation regex narrowed from `\d+` to `\d` → **row 5** (step 10 is the
 *   only two-digit step; rows 4 and 6 are single digits and stay green)
 * - `buildDedupeKey` pushing `stale` into the key → **row 6**, the only row
 *   whose event carries `stale: true`. `F3.52` keeps staleness out of the key on
 *   purpose so that rows earlier ticks wrote under a step's key still match, and
 *   this row is what holds that decision from the reading side.
 */
export function runEventRoundTripTests(): void {
  const raise = { ruleId: RULE_ID, alarmId: ALARM_ID, severity: "warning" };

  const cases: readonly RoundTripCase[] = [
    { what: "a raise with an alarm and a severity", input: raise, expected: "raise" },
    {
      what: "a raise with no alarm",
      input: { ...raise, alarmId: null },
      expected: "raise",
    },
    {
      what: "a raise with no severity",
      input: { ...raise, severity: null },
      expected: "raise",
    },
    {
      what: "escalation step 1",
      input: { ...raise, event: { kind: "escalation", step: 1 } },
      expected: "escalation",
    },
    {
      what: "escalation step 10 — two digits, which `\\d` alone would miss",
      input: { ...raise, event: { kind: "escalation", step: 10 } },
      expected: "escalation",
    },
    {
      what: "a STALE escalation step — `stale` is not in the key, so it reads as the step it is",
      input: { ...raise, event: { kind: "escalation", step: 2, stale: true } },
      expected: "escalation",
    },
    {
      what: "a cleared message",
      input: { ...raise, event: { kind: "cleared" } },
      expected: "cleared",
    },
    {
      what: "a cleared message with no alarm",
      input: { ...raise, alarmId: null, event: { kind: "cleared" } },
      expected: "cleared",
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const dedupeKey = buildDedupeKey(testCase.input);
    const actual = parseDeliveryEvent({
      dedupeKey,
      ruleId: testCase.input.ruleId,
      alarmId: testCase.input.alarmId,
    });
    assert(
      actual === testCase.expected,
      `E1 row ${index + 1} (${testCase.what}): expected ${testCase.expected}, got ${actual} ` +
        `from ${dedupeKey}`,
    );
  }
}

/**
 * `F3.56` E2 — a NULL key is a send test, and nothing else is.
 *
 * Amendment 8's enumeration of writers: `NotificationsService.record()` is the
 * one production insert, and its three `sendTest` call sites are the only ones
 * that pass a literal `null` key with a `null` rule. So `dedupe_key IS NULL` is
 * the send test, and it is step 1 of the parse because every later step would
 * otherwise have to defend itself against a null.
 *
 * Mutation: step 1 returning `unknown` → this block.
 */
export function runTestKindTests(): void {
  const actual = parseDeliveryEvent({ dedupeKey: null, ruleId: null, alarmId: null });
  assert(actual === "test", `E2: a NULL dedupe key is a send test, got ${actual}`);
}

/**
 * `F3.56` E3 — `no-alarm` in a key does NOT mean "test".
 *
 * This is the inversion Amendment 8 says a later reader will make, so it is
 * held by its own block rather than left to E1 row 2. Two real writers produce
 * a `<ruleId>:no-alarm:<severity>` key with a NULL `alarm_id` and both are
 * raises: `F3.46`'s transition refusal, where `AlarmRaiser` returns
 * `alarmId: null` because the already-open conflict is what refused the raise,
 * and a `skipped_unconfigured` row, which can predate any alarm. Only a NULL
 * key is a test.
 *
 * Mutation: inserting `if (row.alarmId === null) return "test"` after step 1 →
 * this block.
 */
export function runNoAlarmRaiseIsARaiseTests(): void {
  const dedupeKey = buildDedupeKey({ ruleId: RULE_ID, alarmId: null, severity: "warning" });
  assert(
    dedupeKey === `${RULE_ID}:no-alarm:warning`,
    `E3 premise: the refusal key is rule:no-alarm:severity, got ${dedupeKey}`,
  );
  const actual = parseDeliveryEvent({ dedupeKey, ruleId: RULE_ID, alarmId: null });
  assert(
    actual === "raise",
    `E3: a no-alarm key with a NULL alarm_id is a RAISE, not a test — got ${actual}`,
  );
}

/**
 * `F3.56` E4a — a non-NULL key on a row with no rule reads as `unknown`.
 *
 * `unknown` is the value Amendment 8 says no writer in this codebase produces,
 * and E4a–c are what drive it through the function anyway, so it is measured
 * rather than dead prose.
 *
 * **What this block does NOT prove, stated rather than implied.** Deleting step
 * 2 outright leaves this block GREEN: with `ruleId === null` the template
 * produces the prefix `null:no-alarm:`, which the key under test does not start
 * with, so step 3 refuses it and returns `unknown` anyway. The mutation this
 * block does kill is step 2 returning `raise` instead of `unknown`. Do not
 * record the deletion as proof of anything.
 */
export function runUnknownWhenTheRuleIsNull(): void {
  const dedupeKey = buildDedupeKey({ ruleId: RULE_ID, alarmId: ALARM_ID, severity: "warning" });
  const actual = parseDeliveryEvent({ dedupeKey, ruleId: null, alarmId: ALARM_ID });
  assert(
    actual === "unknown",
    `E4a: a key with no rule to anchor it is unknown, got ${actual}`,
  );
}

/**
 * `F3.56` E4b — a key that belongs to another rule reads as `unknown`.
 *
 * The prefix is built from the ROW's own `rule_id`, not parsed out of the key,
 * which is what makes a mismatch detectable at all. A parse that read the rule
 * out of the key could never notice.
 *
 * Mutation: step 3 returning `raise` on a mismatch → this block.
 */
export function runUnknownWhenTheKeyIsAnotherRules(): void {
  const dedupeKey = buildDedupeKey({ ruleId: RULE_ID, alarmId: ALARM_ID, severity: "warning" });
  const actual = parseDeliveryEvent({ dedupeKey, ruleId: OTHER_RULE_ID, alarmId: ALARM_ID });
  assert(
    actual === "unknown",
    `E4b: another rule's key is unknown, not a raise — got ${actual}`,
  );
}

/**
 * `F3.56` E4c — a key that belongs to another alarm reads as `unknown`.
 *
 * **Its own block because E4b cannot hold it.** Mutate the prefix to drop the
 * alarm segment (`${ruleId}:` alone) and E4b stays green — its key still starts
 * with a different rule's id and is still refused — while this one turns
 * `RULE:ALARM:warning` into a `raise`. One block per mutation, per §4.6.
 */
export function runUnknownWhenTheKeyIsAnotherAlarms(): void {
  const dedupeKey = buildDedupeKey({ ruleId: RULE_ID, alarmId: ALARM_ID, severity: "warning" });
  const actual = parseDeliveryEvent({ dedupeKey, ruleId: RULE_ID, alarmId: null });
  assert(
    actual === "unknown",
    `E4c: another alarm's key is unknown, not a raise — got ${actual}`,
  );
}

/**
 * `F3.56` E5 — a severity code that mimics a suffix is still a raise.
 *
 * `bms.alarm_severities.code` is `varchar(64)` PRIMARY KEY with **no format
 * CHECK** — the vocabulary is open by design (migration `0030`, ADR 0032) — so
 * none of these three codes is hypothetical in the way a schema constraint
 * would make it. Stripping the prefix the ROW supplies removes both hazards,
 * because the two uuids are known values rather than parsed ones.
 *
 * Ordered for §4.6; each mutation reaches a case no earlier one covers:
 *
 * - a bare `key.endsWith(":cleared")` over the WHOLE key → **case 1**
 * - a `split(":").length` segment count (3 → raise, 4 → cleared, 5 →
 *   escalation, else unknown) → **case 2**. Case 1 has three segments and stays
 *   green under it, which is the point: the segment count is wrong for a
 *   different reason than the bare suffix is.
 * - the escalation regex without its leading colon (`/escalation:\d+$/`) →
 *   **case 3**
 */
export function runSeverityThatMimicsASuffixIsARaise(): void {
  const severities = ["cleared", "sev:high", "escalation:3"];

  for (const [index, severity] of severities.entries()) {
    const dedupeKey = buildDedupeKey({ ruleId: RULE_ID, alarmId: ALARM_ID, severity });
    const actual = parseDeliveryEvent({ dedupeKey, ruleId: RULE_ID, alarmId: ALARM_ID });
    assert(
      actual === "raise",
      `E5 case ${index + 1}: severity ${JSON.stringify(severity)} is a RAISE of that severity, ` +
        `got ${actual} from ${dedupeKey}`,
    );
  }
}

/**
 * `F3.56` E6a — the first residual limit, documented rather than claimed away.
 *
 * A severity code whose OWN text ends in `:cleared` is read as a cleared
 * message. Amendment 8 names this and declines to fix it here: the three seeded
 * codes are `info`, `warning` and `critical`, and a format CHECK on the code
 * belongs to ADR 0032, not to a read path.
 *
 * **If a later row refuses colons in a severity code, Amendment 8's
 * residual-limit paragraph has to be revised and this block deleted with it.**
 * The assertion states today's behaviour, not a desired one, so a fix elsewhere
 * makes it red on purpose.
 */
export function runResidualLimitSeveritySuffix(): void {
  const dedupeKey = buildDedupeKey({ ruleId: RULE_ID, alarmId: ALARM_ID, severity: "x:cleared" });
  const actual = parseDeliveryEvent({ dedupeKey, ruleId: RULE_ID, alarmId: ALARM_ID });
  assert(
    actual === "cleared",
    `E6a: a severity ending in ":cleared" is read as a cleared message — got ${actual}. ` +
      "If this is now `raise`, ADR 0041 Amendment 8's residual-limit paragraph must be revised.",
  );
}

/**
 * `F3.56` E6b — the second residual limit: a key clamped past its own suffix.
 *
 * `buildDedupeKey` clamps at 255 and cuts the TAIL, so a key long enough to
 * lose its suffix reads as a raise. The arithmetic is exact and is asserted
 * before the verdict, because a premise that drifts would make the verdict a
 * coincidence: a 150-character rule id, `:`, a 36-character alarm uuid and `:`
 * is a 188-character prefix; a 64-character severity takes it to 252; the
 * 8-character `:cleared` would take it to 260; the clamp keeps 255, so the tail
 * that survives is `:cl`.
 *
 * **Deliberately not a 400-character rule id.** That key's PREFIX alone exceeds
 * 255, so the row's own prefix no longer matches and the parse reads `unknown`
 * — a third outcome Amendment 8 does not name, and asserting it here would
 * document a behaviour the ADR never ruled on.
 *
 * Same posture as E6a: this states today's behaviour. A fix elsewhere reddens
 * it, and Amendment 8's paragraph has to move with it.
 */
export function runResidualLimitClampedTail(): void {
  const longRuleId = "r".repeat(150);
  const dedupeKey = buildDedupeKey({
    ruleId: longRuleId,
    alarmId: ALARM_ID,
    severity: "s".repeat(64),
    event: { kind: "cleared" },
  });
  assert(
    dedupeKey.length === 255 && dedupeKey.endsWith(":cl"),
    `E6b premise: the clamp must cut ":cleared" down to ":cl", got ${dedupeKey.length} ` +
      `characters ending ${JSON.stringify(dedupeKey.slice(-8))}`,
  );
  const actual = parseDeliveryEvent({ dedupeKey, ruleId: longRuleId, alarmId: ALARM_ID });
  assert(
    actual === "raise",
    `E6b: a key clamped past its own suffix reads as a raise — got ${actual}. ` +
      "If this is now `cleared`, ADR 0041 Amendment 8's residual-limit paragraph must be revised.",
  );
}
