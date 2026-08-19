import { defaultAlarmSeverity } from "./alarm-severity-default";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * ADR 0032, and the defect the migration review caught before merge.
 *
 * This function used to read:
 *
 *     if (value === "critical" || value === "warning" || value === "info") {
 *       return value;
 *     }
 *     return "warning";
 *
 * which was correct while severity was a `z.enum` and wrong the moment ADR 0032
 * made the vocabulary data. The foreign key admits **every** code in
 * `bms.alarm_severities` — that is the entire point — so a rule seeded at
 * `high` passed `automation_rules_severity_fk`, reached here, and had its
 * severity rewritten to `warning` on every alarm it raised.
 *
 * That silently falsified ADR 0032's headline promise: answering client ask
 * `B9` was supposed to cost one `INSERT` and no code change. On the path that
 * matters most — a rule actually raising an alarm — it cost wrong data instead.
 *
 * These cases are the promise, asserted rather than assumed. `F3.6` moved this
 * function out of `AlarmThresholdService` (renamed `AlarmEngineService` by F3.6 task 4), so this spec now calls it directly
 * rather than reaching it through a structural cast on the service.
 */
export function runAlarmSeverityDefaultingTests(): void {
  // The default that is genuinely needed and is deliberate: `alarms.severity`
  // is NOT NULL while `automation_rules.severity` is not, so a rule carrying
  // none has to become something here. `F4.46` moved the defaulting to this
  // edge on purpose.
  assert(
    defaultAlarmSeverity(null) === "warning",
    "a rule with no severity must default to warning",
  );

  // The three seeded levels pass through unchanged.
  for (const code of ["info", "warning", "critical"]) {
    assert(defaultAlarmSeverity(code) === code, `${code} must survive unchanged`);
  }

  // The regression. A level added by an INSERT must reach the alarm row as
  // itself. If this returns "warning", B9 costs an API change and every alarm
  // raised by a `high` rule is recorded at the wrong urgency.
  assert(
    defaultAlarmSeverity("high") === "high",
    "a severity added to the vocabulary must not be downgraded when an alarm is raised",
  );

  // Any other non-null code likewise. It cannot reach here unless the
  // vocabulary declares it — `automation_rules_severity_fk` closed that — so
  // rewriting it would be inventing data, not defending against it.
  assert(
    defaultAlarmSeverity("catastrophic") === "catastrophic",
    "a non-null severity is FK-guaranteed live and must pass through",
  );
}
