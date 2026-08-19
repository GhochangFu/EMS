import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { alarms, assets, ruleExecutions } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { DRIZZLE } from "../database/database.tokens";
import type { AlarmMessageRule } from "../rules/alarm-message";
import { composeAlarmMessage } from "../rules/alarm-message";
import { defaultAlarmSeverity } from "../rules/alarm-severity-default";
import type { EvaluationResult, RuleRow } from "../rules/rules.types";
import { AlarmsGateway } from "./alarms.gateway";

/**
 * Gates *whether* a rule evaluation should raise an alarm — the decision
 * `AlarmEngineService`'s SQL `WHERE ruleType = 'threshold'` used to make
 * implicitly by never loading a time-window rule into its cache in the first
 * place. `RulesService.evaluateEnabledRules` (F3.6 task 5) evaluates every
 * rule type through the same shared engine, so the same decision has to be
 * made explicitly here instead.
 *
 * A time-window rule matching its schedule is not itself an alarm condition —
 * it is a fact `F3.7`'s notification actions will read — so `matched` alone is
 * not sufficient; `ruleType` must also be `threshold`.
 */
export function shouldRaise(
  rule: Pick<RuleRow, "ruleType">,
  evaluation: Pick<EvaluationResult, "matched">,
): boolean {
  return rule.ruleType === "threshold" && evaluation.matched;
}

/**
 * How stale a telemetry sample can be and still be trusted to raise a fresh
 * alarm through the on-demand path. Wider than the 25-second "live" badge
 * `dashboard.service.ts`/`map.service.ts` use for the UI — this only needs to
 * reject a sample from an asset that has stopped reporting (an offline RTU,
 * a decommissioned asset), not ordinary publish jitter across domains.
 */
export const MAX_RAISE_SAMPLE_AGE_MS = 15 * 60 * 1000;

/**
 * Gates a raise on how old its telemetry sample is — separate from
 * `shouldRaise`, which only asks whether the rule matched.
 *
 * `RulesService.evaluateEnabledRules` (F3.6 task 5, on-demand) is the only
 * caller that needs this: it can read a sample of any age from
 * `telemetry.point_values` (730-day retention, ADR 0024), unlike the
 * streaming engine (`AlarmEngineService`), whose samples are always the live
 * reading that just arrived on the hub. Security review, F3.6: without this
 * gate, pressing "Evaluate now" against a long-silent asset raises an alarm
 * off stale data today, and — because acknowledging an alarm clears the
 * dedupe key `alarms_open_per_rule_uidx` relies on — re-opens the same
 * alarm every time the button is pressed again afterwards.
 */
export function isSampleFreshEnoughToRaise(sampleTime: Date, now: Date): boolean {
  return now.getTime() - sampleTime.getTime() <= MAX_RAISE_SAMPLE_AGE_MS;
}

/** What `AlarmRaiser.raise` needs from a rule, regardless of which engine evaluated it. */
export type AlarmRaiseRule = AlarmMessageRule & {
  id: string;
  code: string;
  severity: string | null;
};

export type AlarmRaiseResult = {
  /** `false` when the rule is already open for this asset — the dedupe fired. */
  raised: boolean;
  alarmId: string | null;
};

/**
 * The one writer of `bms.alarms` (F3.6 / ADR 0033).
 *
 * Both engines — the streaming threshold cache (`AlarmEngineService`,
 * task 4) and the on-demand evaluator (`RulesService.evaluateEnabledRules`,
 * task 5) — call this instead of inserting directly, so a shared condition
 * raises exactly one open alarm no matter which path reaches it first.
 *
 * The dedupe is `alarms_open_per_rule_uidx` (migration 0032), enforced by the
 * database, not by a SELECT-then-INSERT read here: `ensureAlarm`'s pre-merge
 * shape did open → insert with nothing between them, so two concurrent
 * reading batches could both see nothing open and both insert — a real race,
 * not a hypothetical one. `.onConflictDoNothing()` is called with no target,
 * emitting a bare `ON CONFLICT DO NOTHING` — Postgres' partial-index arbiter
 * inference requires the ON CONFLICT predicate to *imply* the index's, and
 * `acknowledged_at IS NULL` alone does not imply `... AND rule_id IS NOT
 * NULL`, so a targeted clause here would risk "no unique or exclusion
 * constraint matching" on some plans. The bare form matches any constraint
 * the row could violate and needs no such proof.
 */
@Injectable()
export class AlarmRaiser {
  constructor(
    @Inject(DRIZZLE) private readonly db: BmsDb,
    private readonly gateway: AlarmsGateway,
  ) {}

  /**
   * @param opts.recordTrace Default `true` — writes one `bms.rule_executions`
   *   row on a successful raise (ADR 0033 decision 3). `RulesService`'s
   *   on-demand evaluator (task 5) passes `false`: it already writes a richer
   *   trace for every rule it evaluates, matched or not, and this insert
   *   would otherwise duplicate it. `AlarmEngineService`'s streaming path has
   *   no other mechanism to record why an alarm fired, so it takes the
   *   default.
   */
  async raise(
    assetId: string,
    rule: AlarmRaiseRule,
    value: number,
    opts: { recordTrace?: boolean } = {},
  ): Promise<AlarmRaiseResult> {
    const severity = defaultAlarmSeverity(rule.severity);
    const message = composeAlarmMessage(rule, value);

    const inserted = await this.db
      .insert(alarms)
      .values({
        assetId,
        ruleId: rule.id,
        ruleKey: rule.code,
        severity,
        message,
      })
      .onConflictDoNothing()
      .returning();

    const row = inserted[0];
    if (!row) {
      // Already open for this (asset, rule) — the dedupe, not a failure.
      return { raised: false, alarmId: null };
    }

    const [full] = await this.db
      .select({
        id: alarms.id,
        assetId: alarms.assetId,
        ruleKey: alarms.ruleKey,
        ruleId: alarms.ruleId,
        severity: alarms.severity,
        message: alarms.message,
        raisedAt: alarms.raisedAt,
        acknowledgedAt: alarms.acknowledgedAt,
        acknowledgedBy: alarms.acknowledgedBy,
        assetCode: assets.code,
        assetName: assets.name,
        siteName: assets.siteName,
      })
      .from(alarms)
      .innerJoin(assets, eq(alarms.assetId, assets.id))
      .where(eq(alarms.id, row.id))
      .limit(1);

    if (full) {
      this.gateway.broadcastCreated({
        id: full.id,
        assetId: full.assetId,
        ruleKey: full.ruleKey,
        ruleId: full.ruleId,
        severity: full.severity,
        message: full.message,
        raisedAt: full.raisedAt.toISOString(),
        acknowledgedAt: full.acknowledgedAt?.toISOString() ?? null,
        acknowledgedBy: full.acknowledgedBy,
        assetCode: full.assetCode,
        assetName: full.assetName,
        siteName: full.siteName,
      });
    }

    // Traced only on a raise (ADR 0033 decision 3) — bms.rule_executions has
    // no retention policy, and an every-evaluation trace is (readings × rules)
    // rows per batch. Skippable — see the `recordTrace` doc above.
    //
    // `raisedBy`, not `source`: code review caught that `source` here and
    // `RulesService.evaluateEnabledRules`'s own trace insert
    // (`source: row.source`, `automation_rules.source` — `operator_rule` /
    // `simulator_threshold` / `phe_alarm_seed`) would otherwise write the same
    // JSON key with two disjoint vocabularies into the same table, readable
    // only by which engine happened to reach the rule.
    if (opts.recordTrace ?? true) {
      await this.db.insert(ruleExecutions).values({
        ruleId: rule.id,
        status: "matched",
        matched: true,
        observedValue: value,
        message,
        trace: { assetId, alarmId: row.id, raisedBy: "alarm_engine" },
      });
    }

    return { raised: true, alarmId: row.id };
  }
}
