/**
 * `F3.8` — the dedupe key written on every delivery row (ADR 0041 decision 7).
 *
 * A pure function, separate from the service, because what counts as "the same
 * notification" is a decision worth reading on its own.
 *
 * **The key is the rule and the alarm, not the message text.** Two raises of
 * the same rule against the same alarm are the same event even if the observed
 * value in the message differs by a decimal — and they will differ, because the
 * message carries the reading. Keying on the text would defeat the dedupe on
 * exactly the storm it exists to stop.
 *
 * The alarm is included rather than the rule alone: when an alarm **clears**
 * (ADR 0057 decision 1 — `cleared_at`, stamped by the lifecycle sweep) and the
 * condition breaches again, a new `bms.alarms` row exists, and that genuinely
 * is a new event the operator wants to hear about. Acknowledgement is not that
 * boundary any more: since ADR 0057 decision 2 an acknowledged alarm whose
 * condition still holds stays the same row, so it stays the same key.
 *
 * **Since `F3.46` the key has a reader, not only a writer.** Before a refusal
 * is recorded, `NotificationsService.hasRecordedSkip` looks this key up on the
 * channel and writes the row only if no `skipped_deduped` row holds it yet, so
 * an unchanged plant stops growing the ledger one row per press.
 *
 * On the sweep path the refusal's key is `<ruleId>:no-alarm:<severity>`, not
 * the open alarm's: `AlarmRaiser` returns `alarmId: null` when the
 * already-open conflict is the thing that refused the raise. Suppression there
 * is therefore per rule and severity for the life of the ledger, not per alarm
 * episode — accepted by the owner (ruling Q1, 2026-09-06), because the answer
 * the row exists to give, *"already open"*, is the same for every episode of
 * it, and `bms.rule_executions` still records that the sweep reached the rule.
 *
 * **`F3.10` — the event suffix (ADR 0057 decision 9).** An escalation step or
 * a cleared message for the same alarm is a different event from its raise, so
 * it gets a different key: `:escalation:<n>` or `:cleared` appended to the
 * raise key. The kind lives here and nowhere else — no column was added — and
 * `NotificationsService.eventDeliveryBlocked` reads the key back before a step
 * or a clear is sent, which is what makes decision 10's "once per channel"
 * a ledger read instead of a timer. Since `F3.48` a step the hourly ceiling
 * refused leaves no row under its key, so the key survives to be retried on a
 * later tick — the absence is deliberate. The suffix goes at the end so that the
 * raise key is a strict prefix of every event key for that alarm and never
 * equal to one: the raise row is already in the ledger when the sweep asks
 * about step 1, and an equal key would make every step look already sent.
 *
 * Bounded to the column width — `dedupe_key varchar(255)` in migration 0038 —
 * so a long rule id can never make the insert fail. Two uuids, a severity and
 * the longest suffix are far short of it; the clamp is there for the case
 * nobody predicted.
 */
const MAX_DEDUPE_KEY_LENGTH = 255;

/**
 * Which lifecycle event a dispatch is for (ADR 0057 decision 9). Absent on the
 * raise path; set by the alarm lifecycle sweep.
 *
 * **`F3.52` — `stale` marks a step the sweep found too late to send** (ADR 0041
 * Amendment 6 §2, ADR 0057 Amendment 7). Two things about its placement are
 * load-bearing:
 *
 * - It is **optional**, so every existing `{ kind: "escalation", step: n }`
 *   still typechecks and only the escalation phase has to answer the question.
 * - It is on the **escalation variant only**. A raise, a re-offered raise and a
 *   cleared message cannot carry it — that is the type-level half of ruling 1's
 *   gate, and it matters because a `skipped_stale` row under a RAISE key would
 *   block that raise for ever (`channelsOwedTheRaise` excludes only
 *   `skipped_rate_limited` and a stale `skipped_unconfigured`).
 *
 * It does NOT reach `buildDedupeKey` below: a step's key stays
 * `rule:alarm:severity:escalation:<n>`, so the rows earlier ticks wrote under
 * it still match. `alarm-lifecycle.spec.ts` asserts that identity.
 */
export type DispatchEvent =
  | { kind: "escalation"; step: number; stale?: true }
  | { kind: "cleared" };

/** The key for one notification: `rule:alarm:severity`, plus the event suffix when there is one. */
export function buildDedupeKey(input: {
  ruleId: string;
  alarmId: string | null;
  severity: string | null;
  event?: DispatchEvent;
}): string {
  const parts = [input.ruleId, input.alarmId ?? "no-alarm", input.severity ?? "no-severity"];
  if (input.event?.kind === "escalation") {
    parts.push("escalation", String(input.event.step));
  } else if (input.event?.kind === "cleared") {
    parts.push("cleared");
  }
  const key = parts.join(":");
  return key.length > MAX_DEDUPE_KEY_LENGTH ? key.slice(0, MAX_DEDUPE_KEY_LENGTH) : key;
}
