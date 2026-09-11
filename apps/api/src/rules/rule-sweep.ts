import type { Logger } from "@nestjs/common";

import type { RuleSweepSummary } from "@bms/shared";

import {
  isSampleFreshEnoughToRaise,
  shouldRaise,
  type AlarmRaiser,
} from "../alarms/alarm-raise.service";
import type { NotificationsService } from "../notifications/notifications.service";
import { alarmMessageFieldsFromCondition } from "./alarm-message";
import { notifyOnRaise } from "./rule-actions";
import { evaluateRule, type LatestSampleLoader } from "./rule-evaluation";
import type { RuleRow } from "./rules.types";

/**
 * `F3.11` / ADR 0064 decisions 1, 5, 9; Amendment 1 A4 — the scheduled sweep
 * body, pure over its deps so `rule-sweep.spec.ts` can drive it with a
 * recording raiser and a stepping clock. `RuleSweepService` composes the deps
 * against the real pools; `WorkerHostService` calls it from the `rules-sweep`
 * processor.
 *
 * **The rows are the press's; the write policy is the streaming engine's.**
 * It walks the same rows `POST /rules/evaluate` walks (`selectRuleRows` on the
 * fleet handle, `enabled && lifecycleStatus === "published"`, one
 * `batchedLatestPointValues` batch) and the same evaluator
 * (`evaluateRule`), and then does what `AlarmEngineService` does rather than
 * what `RulesService.evaluateEnabledRules` does:
 *
 * - `AlarmRaiser.raise` with its **default** trace — a `bms.rule_executions`
 *   row only when an alarm is actually raised (ADR 0033 decision 3), tagged
 *   `raisedBy: "rule_sweep"`. No `recordTrace` key, no `evaluatedBy`: nobody
 *   pressed anything.
 * - `notifyOnRaise` **only when `raised.raised`** (the engine's transition
 *   rule, `F3.7` Q2). A matched rule whose alarm is already open writes
 *   nothing and tells nobody; the press's every-attempt policy is the
 *   asymmetric half and stays on the route.
 * - `isSampleFreshEnoughToRaise` bounds every raise, both sides, exactly as
 *   the press bounds its own: a stale match is a trace-less no-op.
 * - Per-rule `try/catch` (the engine's `F4.36` shape): one rule's failure
 *   warns and moves on. The failed id is **not** stamped — `last_evaluated_at`
 *   means "last completed evaluation".
 * - `last_evaluated_at` once per sweep, **one statement per organization**
 *   under that organization's GUC (`stampEvaluated`), `updated_at` untouched
 *   (A4). A stamp failure for one organization warns and the rest still land.
 *
 * §9.6: the two warn lines carry a rule id or an organization id and the
 * error object, never an observed value, a threshold or an alarm message.
 */
export type RuleSweepDeps = {
  /** The cross-organization read — `selectRuleRows` on the fleet handle (ADR 0033 decision 2). */
  readRules(): Promise<RuleRow[]>;
  /** One `batchedLatestPointValues` batch on the tenant pool (`rule-samples.ts` says why that pool). */
  loadSamples(rows: RuleRow[]): Promise<LatestSampleLoader>;
  raiser: Pick<AlarmRaiser, "raise">;
  notifications: Pick<NotificationsService, "dispatch">;
  /** `withTenant(organizationId)` + `stampRulesEvaluated` — one statement for the whole id list. */
  stampEvaluated(organizationId: string, ruleIds: string[], at: Date): Promise<void>;
  logger: Pick<Logger, "warn" | "log">;
  /** The clock, injected so the summary's arithmetic is testable — `Date.now` in production. */
  now(): number;
};

/**
 * One sweep over `deps.readRules()` with the streaming engine's write policy
 * (ADR 0064 decisions 1, 5, 9; Amendment 1 A4): a raise, a trace and a
 * dispatch only on `raised: true`, every raise bounded by sample freshness,
 * per-rule isolation, then one `last_evaluated_at` stamp per organization.
 * Pure over its deps — `RuleSweepService.run` supplies the pools.
 */
export async function runRuleSweep(deps: RuleSweepDeps): Promise<RuleSweepSummary> {
  const started = deps.now();
  const rows = (await deps.readRules()).filter(
    (row) => row.enabled && row.lifecycleStatus === "published",
  );
  const loader = await deps.loadSamples(rows);
  const now = new Date(deps.now());

  let evaluated = 0;
  let raised = 0;
  /** Completed rule ids grouped by the rule's own organization — the stamp's GUC. */
  const byOrg = new Map<string, string[]>();

  for (const row of rows) {
    // E7.1b, the press's line: a rule with no org — none exists on real data
    // (the 0046 backfill aborts on it) — cannot be stamped under a GUC, so it
    // is skipped with a warning rather than failing the sweep for every
    // other tenant (decision 9).
    if (!row.organizationId) {
      deps.logger.warn(
        `rule sweep: skipping rule ${row.code} (${row.id}) with no organization_id`,
      );
      continue;
    }
    const ruleOrg = row.organizationId;

    try {
      const result = await evaluateRule(row, loader, now);
      evaluated += 1;

      if (
        shouldRaise(row, result) &&
        row.assetId &&
        row.pointKey &&
        result.observedValue !== null &&
        row.assetOrganizationId
      ) {
        // The loader's sample can be of any age (see `batchedLatestPointValues`'s
        // doc comment); the bound sits here, on the raise, not in the loader.
        const sample = await loader(row.assetId, row.pointKey);
        if (sample && isSampleFreshEnoughToRaise(sample.time, now)) {
          const { alarmMessage, unit } = alarmMessageFieldsFromCondition(row.condition);
          const outcome = await deps.raiser.raise(
            row.assetId,
            row.assetOrganizationId,
            {
              id: row.id,
              code: row.code,
              name: row.name,
              pointKey: row.pointKey,
              severity: row.severity,
              organizationId: ruleOrg,
              alarmMessage,
              unit,
            },
            result.observedValue,
            { raisedBy: "rule_sweep" },
          );
          if (outcome.raised) {
            raised += 1;
            // Fire-and-forget; `notifyOnRaise` neither awaits nor throws.
            notifyOnRaise(
              { notifications: deps.notifications, logger: deps.logger },
              { id: row.id, code: row.code, organizationId: ruleOrg, action: row.action },
              outcome,
            );
          }
        }
      }

      const ids = byOrg.get(ruleOrg);
      if (ids) {
        ids.push(row.id);
      } else {
        byOrg.set(ruleOrg, [row.id]);
      }
    } catch (err) {
      deps.logger.warn({ err, ruleId: row.id }, "rule sweep: one rule failed; continuing");
    }
  }

  const finishedAt = new Date(deps.now());
  for (const [organizationId, ruleIds] of byOrg) {
    try {
      await deps.stampEvaluated(organizationId, ruleIds, finishedAt);
    } catch (err) {
      deps.logger.warn(
        { err, organizationId },
        "rule sweep: last_evaluated_at stamp failed for one organization; continuing",
      );
    }
  }

  return {
    finishedAt: finishedAt.toISOString(),
    evaluated,
    raised,
    durationMs: deps.now() - started,
  };
}
