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
 * The alarm is included rather than the rule alone: when an alarm is
 * acknowledged and the condition trips again, a new `bms.alarms` row exists,
 * and that genuinely is a new event the operator wants to hear about.
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
 * Bounded to the column width — `dedupe_key varchar(255)` in migration 0038 —
 * so a long rule id can never make the insert fail. Two uuids and a severity
 * are far short of it; the clamp is there for the case nobody predicted.
 */
const MAX_DEDUPE_KEY_LENGTH = 255;

export function buildDedupeKey(input: {
  ruleId: string;
  alarmId: string | null;
  severity: string | null;
}): string {
  const key = [input.ruleId, input.alarmId ?? "no-alarm", input.severity ?? "no-severity"].join(
    ":",
  );
  return key.length > MAX_DEDUPE_KEY_LENGTH ? key.slice(0, MAX_DEDUPE_KEY_LENGTH) : key;
}
