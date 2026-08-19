import type { AlarmSeverityDto, AutomationRuleSeverity, AutomationRuleType } from "@bms/shared";

/**
 * The severities a rule may carry — **re-exported, not restated** (AGENTS.md
 * §4.8). Since ADR 0032 the list is not a union at all: it is the set of `code`
 * values in `bms.alarm_severities`, so this is a code, and liveness is decided
 * by the vocabulary rather than by the type. A rule may also carry none, which
 * is what the `| null` at each use site says.
 */
export type RuleSeverity = AutomationRuleSeverity;

/**
 * Narrows a stored severity for the rule builder, **preserving "none"**.
 *
 * `automation_rules.severity` is nullable (`bms-schema.ts:560`) and the read
 * contract types it `z.string().nullable()` (`contracts/operations.ts:359`), so
 * the builder has to narrow it before it can put it in a `<select>`. Narrowing
 * is all this does. Substituting a value is `F4.46`: the version of this that
 * lived inline in `rule-builder-panel.tsx` returned `"warning"` for `null`, so
 * loading the one rule that has no severity and pressing Save gave it one.
 *
 * That a rule can have none is not an accident of the seed. The streaming
 * alarm engine only ever loads `ruleType = "threshold"`
 * (`alarm-engine.service.ts:81`, renamed from `AlarmThresholdService` by
 * F3.6), and `shouldRaise` (`alarm-raise.service.ts`) makes the same
 * exclusion explicit for the on-demand evaluator, which has no such query to
 * filter on — so a time-window rule, `weekday_energy_review` the only one,
 * has nothing to be severe about on either path.
 *
 * An unrecognised string maps to `null` for the same reason: it is the only
 * answer that does not invent data, and the builder shows it as `None` rather
 * than silently displaying a severity the rule does not have.
 *
 * **ADR 0032 changed what "unrecognised" is measured against, not the answer.**
 * It used to mean "outside `automationRuleSeveritySchema`", which was a
 * `z.enum`; that schema is now shape-only, so a static check would accept every
 * string and this function would never return `null` for a bad code. The
 * vocabulary is passed in instead. `automation_rules_severity_fk` makes a
 * stored unknown impossible at rest, so this fires on vocabulary skew — a
 * retired code, or a client holding a stale list.
 *
 * It runs in the other direction too, on the `<select>`'s value. `""` is how
 * "no severity" is spelled in the DOM and is not a value the schema accepts, so
 * it has to become `null` before it is sent — otherwise clearing the field
 * would be a 400 rather than a clear. Same rule, same answer, which is why
 * there is one function and not two.
 */
export function severityFromRule(
  value: string | null,
  vocabulary: readonly AlarmSeverityDto[],
): RuleSeverity | null {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return vocabulary.some((entry) => entry.code === value) ? value : null;
}

/**
 * Whether the builder offers `None` as a severity for the rule being edited.
 *
 * `F4.46` is a **display** defect: a stored null has to survive being looked at.
 * It is not a licence to make "no severity" a fresh choice on rules that feed
 * the alarm engine — that is product scope, and the owner's call (§10), so the
 * option is offered only where it is already the truth:
 *
 * - a **time-window** rule, which the streaming alarm engine never loads
 *   (`alarm-engine.service.ts:81`) and `shouldRaise` (`alarm-raise.service
 *   .ts`) excludes on the on-demand path too, so it has nothing to be severe
 *   about; or
 * - **any** rule that already holds no severity, whatever its type.
 *
 * The second arm is the one that is easy to leave out and is not optional.
 * `severity` is nullable for every rule type, so a threshold rule with no
 * severity is reachable through the API today. Gating on the type alone would
 * render a `<select>` whose value matches none of its options; a browser then
 * shows the first one, and Save writes `info` — `F4.46` again, in a new place.
 * That failure is exactly the one `F4.43` already paid for once, on the
 * category control.
 */
export function offersNoSeverityOption(
  ruleType: AutomationRuleType,
  severity: RuleSeverity | null,
): boolean {
  return ruleType === "time_window" || severity === null;
}
