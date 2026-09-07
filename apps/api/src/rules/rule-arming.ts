import { BadRequestException } from "@nestjs/common";

import type { RuleRow } from "./rules.types";

/**
 * Whether a rule may be armed — ADR 0058 decision 3.
 *
 * `E2.4` seeds one automation rule per template alarm. An alarm that carries no
 * `operator` and no `thresholdValue` is an **alarm philosophy row** (ADR 0019
 * Amendment 2, decisions 1–2): the ISA-18.2 rationalization record for the asset
 * class, whose limit is chosen per site at commissioning. It still becomes a
 * `rule_type = 'threshold'` row, disabled, with both columns `NULL`, so that the
 * Rule Engine shows a visible commissioning worklist instead of a silent gap.
 *
 * That shape is armable *in principle*, which is why enabling it has to be
 * refused: the streaming engine's cache query already filters to a non-null
 * operator and threshold (`alarm-engine.service.ts`), so an enabled half-built
 * row would sit in the list looking live while evaluating nothing at all.
 *
 * **This is the only new guard decision 3 needs.** The update path already
 * refuses the same shape from inside `validateRuleDraft`, and
 * `ruleUpdateBodySchema` has no `enabled` field to enable anything with — so a
 * philosophy row is commissioned by one PATCH carrying **both** fields, and
 * armed by the toggle afterwards. `rules.service.spec.ts` pins that existing
 * refusal by name so nobody adds a second copy of it here.
 *
 * A separate file rather than a private method for the usual §4.5 reason
 * (`rules.service.ts` sits against the 1000-line cap), and because a pure
 * function over four columns is testable without a database — which the toggle
 * itself is not. The wiring proof, that `setEnabled` really returns a 400 for a
 * seeded row, is an integration case.
 */
export function assertArmable(
  row: Pick<RuleRow, "ruleType" | "operator" | "thresholdValue" | "code">,
): void {
  // Keyed on `ruleType`, not on the two columns alone: a `time_window` rule
  // legitimately stores `null` for both (`validateRuleDraft`'s other branch
  // writes exactly that), and refusing to enable one would break every rule of
  // that kind that already exists.
  if (row.ruleType !== "threshold") {
    return;
  }
  // `undefined` as well as `null`, because the argument is a `Pick` of a row
  // shape rather than the row a query returned, and a caller assembling one by
  // hand would otherwise slip a missing key past a `=== null` check.
  const missing = (value: unknown): boolean => value === null || value === undefined;
  if (!missing(row.operator) && !missing(row.thresholdValue)) {
    return;
  }
  // The code is in the message because the Rule Engine lists a whole batch of
  // seeded philosophy rows at once, and the web toggle surfaces this text
  // verbatim through `apiErrorMessage` — "a rule" would not say which one.
  throw new BadRequestException(
    `Rule ${row.code} cannot be enabled: a threshold rule needs both an operator ` +
      `and a threshold value. Set both, then enable it (ADR 0058 decision 3).`,
  );
}
