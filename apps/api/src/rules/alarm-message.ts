/**
 * Composes the human-readable message for a matched threshold rule.
 *
 * Pure — no database, no clock. Mirrors `rule-evaluation.ts`'s contract:
 * everything that decides what a matched rule *says* lives here, not in
 * whichever engine happens to raise the alarm.
 *
 * `condition.alarmMessage` is a marker a migration wrote as data (`0022`),
 * read against a closed `if`-chain here. A marker or point this function does
 * not recognise falls through to a generic message naming the rule and the
 * value — never an empty or misleading string — because the chain reads an
 * open jsonb field a future migration can extend without this function's
 * agreement (the `F4.43` empty-badge shape).
 *
 * The unit is read from `rule.unit` (`condition.unit`, e.g. `0022`'s
 * `"unit":"V"`) — never guessed from `pointKey`, so a future rule on a
 * differently-unitted point still renders correctly.
 */

export type AlarmMessageRule = {
  name: string;
  pointKey: string | null;
  alarmMessage: string | null;
  unit: string | null;
};

export function composeAlarmMessage(rule: AlarmMessageRule, value: number): string {
  const unitSuffix = rule.unit ? ` ${rule.unit}` : "";

  if (rule.alarmMessage === "voltage_l1_critical") {
    return `L1 voltage critically high (${value.toFixed(1)}${unitSuffix})`;
  }
  if (rule.alarmMessage === "voltage_l1_high") {
    return `L1 voltage above nominal envelope (${value.toFixed(1)}${unitSuffix})`;
  }
  if (rule.alarmMessage === "breaker_main_open") {
    return "Main breaker reported OPEN";
  }
  if (rule.pointKey === "kw") {
    return `Asset demand high (${value.toFixed(0)}${unitSuffix})`;
  }
  if (rule.pointKey === "pf") {
    return `Power factor low (${value.toFixed(2)})`;
  }
  return `${rule.name} matched at ${value}`;
}

/**
 * Extracts the two `condition` fields both engines need to compose an alarm
 * message — `AlarmEngineService`'s cache build and `RulesService`'s on-demand
 * evaluator (F3.6 task 5) previously each parsed this jsonb column inline,
 * identically. One reader, so a future field (or a stricter `condition`
 * schema) only has one call site to agree with.
 */
export function alarmMessageFieldsFromCondition(
  condition: unknown,
): Pick<AlarmMessageRule, "alarmMessage" | "unit"> {
  const obj = typeof condition === "object" && condition !== null
    ? (condition as Record<string, unknown>)
    : {};
  return {
    alarmMessage: typeof obj.alarmMessage === "string" ? obj.alarmMessage : null,
    unit: typeof obj.unit === "string" ? obj.unit : null,
  };
}
