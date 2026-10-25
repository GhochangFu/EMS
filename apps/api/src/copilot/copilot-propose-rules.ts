import { HttpException } from "@nestjs/common";

import type { RuleProposalCheckService } from "../rules/rule-proposal-check.service";

/**
 * `F4.278` (ADR 0099 Amendment 8, Q9) — the propose tools' rule step, split
 * from `copilot-propose-tools.ts` (the `copilot-upload-prepare.ts` shape).
 *
 * Before a rule card is stored the server runs `RuleProposalCheckService`:
 * the route's own refusals (the validator, `assertArmable`, the lifecycle
 * sentences) and the write-free "would match now" evaluation and 7-day
 * backtest. A refusal is the route's sentence, returned to the model; the
 * check's note is appended to the card's summary.
 */

/** The seven rule entries (`packages/shared/src/copilot/catalog/rules.ts`). */
export const RULE_ENTRY_IDS: ReadonlySet<string> = new Set([
  "rule.create",
  "rule.update",
  "rule.duplicate",
  "rule.publish",
  "rule.enable",
  "rule.disable",
  "rule.archive",
]);

/** A rule proposal on tools built without the check fails closed: nothing is stored. */
export const PROPOSE_RULES_UNAVAILABLE_ERROR =
  "An alarm rule cannot be proposed here. Tell the user to use the Rule Engine page.";

export type CopilotRuleChecks = Pick<RuleProposalCheckService, "check">;

/** Runs the check; an `HttpException` is the route's refusal, any other error is re-thrown. */
export async function checkRule(
  rules: CopilotRuleChecks | undefined,
  entryId: string,
  params: Readonly<Record<string, string>>,
  body: Readonly<Record<string, unknown>>,
  organizationId: string,
  now: Date,
): Promise<{ ok: true; note: string } | { ok: false; error: string }> {
  if (rules === undefined) return { ok: false, error: PROPOSE_RULES_UNAVAILABLE_ERROR };
  try {
    const { note } = await rules.check({ entryId, params, body, organizationId, now });
    return { ok: true, note };
  } catch (err) {
    if (err instanceof HttpException) return { ok: false, error: err.message };
    throw err;
  }
}
