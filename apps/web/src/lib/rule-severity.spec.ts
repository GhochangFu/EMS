import type { AlarmSeverityDto } from "@bms/shared";

import { offersNoSeverityOption, severityFromRule } from "./rule-severity";

/**
 * What migration `0030` seeds (ADR 0032). `severityFromRule` narrows against
 * the vocabulary now rather than against a `z.enum`, because that schema became
 * shape-only when the set moved into the database — a static check would accept
 * every string and never report "none".
 */
const SEEDED: AlarmSeverityDto[] = [
  { code: "info", label: "Info", tone: "info", rank: 10, active: true },
  { code: "warning", label: "Warning", tone: "warning", rank: 20, active: true },
  { code: "critical", label: "Critical", tone: "critical", rank: 30, active: true },
];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * `F4.46`. The rule builder's half of the same defect the API had: it could not
 * represent "this rule has no severity", so opening such a rule and saving it
 * invented one.
 *
 * The old narrowing lived inline in `rule-builder-panel.tsx` and returned
 * `"warning"` for `null`. That is why these cases are worth having as a unit at
 * all — the function is three lines, but the three lines are the bug, and the
 * form state type they feed is what made the bug unrepresentable-as-a-fix
 * before now.
 */
export function runRuleSeverityTests(): void {
  assert(severityFromRule("info", SEEDED) === "info", "info must survive");
  assert(severityFromRule("warning", SEEDED) === "warning", "warning must survive");
  assert(severityFromRule("critical", SEEDED) === "critical", "critical must survive");

  assert(
    severityFromRule(null, SEEDED) === null,
    "a rule with no severity must stay a rule with no severity",
  );

  // Nothing can write this today — `rules.schema.ts:32` is an enum and no row
  // holds anything else — but reporting "none" is the only answer that does not
  // invent data, and it is the visible one: the control reads `None` rather
  // than showing a severity the rule does not have.
  assert(
    severityFromRule("major", SEEDED) === null,
    "an unrecognised severity must degrade to none, not to a guess",
  );

  // The same function reads the `<select>` back. Its empty option is how "none"
  // is expressed in the DOM, and it has to leave as `null` rather than as the
  // empty string, which `severitySchema` would reject.
  assert(severityFromRule("", SEEDED) === null, "the empty option must mean no severity");
}

/**
 * `F4.46` is a display defect, so the fix has to make a stored null
 * *representable* without making it newly *authorable* on rules that feed the
 * alarm engine. Both halves of that are load-bearing, and the second case below
 * is the one a narrower gate would get wrong.
 */
export function runNoSeverityOptionTests(): void {
  assert(
    offersNoSeverityOption("time_window", null),
    "a time-window rule with no severity must be able to say so",
  );
  assert(
    offersNoSeverityOption("time_window", "info"),
    "a time-window rule may clear a severity it never needed",
  );

  // The arm that is easy to omit. `severity` is nullable for every rule type,
  // so this row is reachable through the API today; gating on the type alone
  // would render a `<select>` holding a value none of its options carry, the
  // browser would show the first one, and Save would write it.
  assert(
    offersNoSeverityOption("threshold", null),
    "a threshold rule that already has no severity must still render as None",
  );

  // ...but a threshold rule that HAS one is not offered a way to drop it here.
  // Whether it should be is product scope, not this fix (AGENTS.md §10).
  assert(
    !offersNoSeverityOption("threshold", "warning"),
    "clearing a threshold rule's severity is not authorable from the builder",
  );
  assert(
    !offersNoSeverityOption("threshold", "critical"),
    "a critical threshold rule keeps its severity as a required choice",
  );
}
