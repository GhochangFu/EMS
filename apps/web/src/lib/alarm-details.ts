import type { AlarmSkillDto, AutomationRuleOperator } from "@bms/shared";

/**
 * `automationRuleOperatorSchema` is closed (`z.enum(["gt","gte","lt","lte","eq"])`),
 * unlike `severity`/`skill` — an exhaustive `switch` is the correct §4.8 shape
 * here, not the open-vocabulary lookup pattern `alarmSkillLabel` uses below.
 * The `never` default is what would fail `pnpm typecheck` if the operator
 * vocabulary ever widened, the way `categoryStyle` (`F4.43`) did not.
 */
export function operatorSymbol(operator: AutomationRuleOperator): string {
  switch (operator) {
    case "gt":
      return ">";
    case "gte":
      return "≥";
    case "lt":
      return "<";
    case "lte":
      return "≤";
    case "eq":
      return "=";
    default: {
      const exhaustive: never = operator;
      throw new Error(`unhandled automation rule operator: ${String(exhaustive)}`);
    }
  }
}

export type ThresholdPairing = {
  current: string;
  threshold: string;
};

/**
 * The value-vs-threshold pairing for the Alarm Details panel ("112%" beside
 * ">100%") — ADR 0034 decision 5. `null` when any of the three fields is
 * `null`, which they always are together for an alarm with no linked rule
 * (`ruleId IS NULL`); rendering nothing is the honest state, not
 * "undefinedundefined".
 */
export function formatThresholdPairing(details: {
  currentValue: number | null;
  currentValueUnit: string | null;
  thresholdOperator: AutomationRuleOperator | null;
  thresholdValue: number | null;
}): ThresholdPairing | null {
  if (
    details.currentValue === null ||
    details.thresholdOperator === null ||
    details.thresholdValue === null
  ) {
    return null;
  }
  const unit = details.currentValueUnit ?? "";
  return {
    current: `${details.currentValue}${unit}`,
    threshold: `${operatorSymbol(details.thresholdOperator)}${details.thresholdValue}${unit}`,
  };
}

/**
 * A skill/trade label resolved by code against the vocabulary (ADR 0034),
 * matching `alarmSeverityTone`'s posture: never a hardcoded list. Falls back
 * to the raw code — not to a placeholder — so a retired code, or a client
 * holding a stale vocabulary while a new trade is seeded, still shows
 * something meaningful rather than vanishing.
 */
export function alarmSkillLabel(
  code: string | null,
  vocabulary: readonly AlarmSkillDto[],
): string | null {
  if (!code) {
    return null;
  }
  return vocabulary.find((entry) => entry.code === code)?.label ?? code;
}

/**
 * UTC ISO → the local-time string an `<input type="datetime-local">`
 * expects. Code review finding: displaying a stored ETR by slicing its UTC
 * ISO string directly renders those UTC digits as if they were local time,
 * wrong by the machine's UTC offset in every timezone but +0. Uses local
 * `Date` getters — `getHours`/`getMinutes`, not `getUTCHours` — precisely
 * because those return the wall-clock time in the browser's own timezone.
 */
export function toLocalDateTimeInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
