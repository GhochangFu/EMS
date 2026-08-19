/**
 * Supplies the one default `alarms.severity` genuinely needs, and nothing else.
 *
 * `alarms.severity` is `NOT NULL` while `automation_rules.severity` is not, so
 * a rule carrying none has to become something here — `F4.46` moved the
 * defaulting *to* this edge on purpose, and `"warning"` is that default.
 *
 * **It used to also rewrite any unrecognised string to `"warning"`, and that
 * arm was wrong under ADR 0032.** The migration review caught it: the foreign
 * key admits every code in `bms.alarm_severities`, which is the entire point
 * of the design, so a rule seeded at `high` passed the FK and then had its
 * severity silently downgraded to `warning` on every alarm it raised. That
 * made ADR 0032's headline promise — answering client ask `B9` costs one
 * INSERT and no code change — false on the one path that matters most.
 *
 * A non-null value is therefore passed through. It cannot be a code the
 * vocabulary does not contain: `automation_rules_severity_fk` closed that,
 * and `alarms_severity_fk` would reject the write anyway rather than let a
 * bad value land.
 */
export function defaultAlarmSeverity(value: string | null): string {
  return value ?? "warning";
}
