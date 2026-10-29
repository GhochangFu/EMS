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

/** The eight rule entries (`packages/shared/src/copilot/catalog/rules.ts`); `F4.289` adds the batch. */
export const RULE_ENTRY_IDS: ReadonlySet<string> = new Set([
  "rule.create",
  "rule.update",
  "rule.duplicate",
  "rule.publish",
  "rule.enable",
  "rule.disable",
  "rule.archive",
  "rule.createBatch",
]);

/** A rule proposal on tools built without the check fails closed: nothing is stored. */
export const PROPOSE_RULES_UNAVAILABLE_ERROR =
  "An alarm rule cannot be proposed here. Tell the user to use the Rule Engine page.";

export type CopilotRuleChecks = Pick<RuleProposalCheckService, "check" | "checkBatch">;

/**
 * Runs the check; an `HttpException` is the route's refusal, any other error is re-thrown.
 * `F4.289` (Amendment 9 E3): the batch runs `checkBatch` over the model's rows, and its per-row
 * result is the card-only `checks` (left out of the hash, stripped by the browser on Confirm).
 */
export async function checkRule(
  rules: CopilotRuleChecks | undefined,
  entryId: string,
  params: Readonly<Record<string, string>>,
  body: Readonly<Record<string, unknown>>,
  organizationId: string,
  now: Date,
): Promise<{ ok: true; note: string; cardBody: Record<string, unknown> } | { ok: false; error: string }> {
  if (rules === undefined) return { ok: false, error: PROPOSE_RULES_UNAVAILABLE_ERROR };
  try {
    if (entryId === "rule.createBatch") {
      const rows = Array.isArray(body.rules) ? (body.rules as unknown[]) : [];
      const checked = await rules.checkBatch({ rows, organizationId, now });
      return { ok: true, note: checked.note, cardBody: { checks: checked.rows } };
    }
    const { note } = await rules.check({ entryId, params, body, organizationId, now });
    return { ok: true, note, cardBody: {} };
  } catch (err) {
    if (err instanceof HttpException) return { ok: false, error: err.message };
    throw err;
  }
}
