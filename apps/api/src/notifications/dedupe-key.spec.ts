import { buildDedupeKey, type DispatchEvent } from "./dedupe-key";

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
