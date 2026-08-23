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
