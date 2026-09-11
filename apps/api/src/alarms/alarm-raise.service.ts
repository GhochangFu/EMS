import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { alarms, ruleExecutions } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import type { AlarmMessageRule } from "../rules/alarm-message";
import { composeAlarmMessage } from "../rules/alarm-message";
import { defaultAlarmSeverity } from "../rules/alarm-severity-default";
import type { EvaluationResult, RuleRow } from "../rules/rules.types";
import { ALARM_NOTIFY_CHANNEL, encodeAlarmNotification } from "./alarm-notify-channel";

/**
 * Gates *whether* a rule evaluation should raise an alarm — the decision
 * `AlarmEngineService`'s SQL `WHERE ruleType = 'threshold'` used to make
 * implicitly by never loading a time-window rule into its cache in the first
 * place. `RulesService.evaluateEnabledRules` (F3.6 task 5) evaluates every
 * rule type through the same shared engine, so the same decision has to be
 * made explicitly here instead.
 *
 * A time-window rule matching its schedule is not itself an alarm condition,
 * and nothing downstream reads the match either: `F3.7`'s notification
 * actions key on an alarm *opening* (ADR 0041 decision 7), which only a
 * threshold rule can do. So `matched` alone is not sufficient; `ruleType` must
 * also be `threshold`.
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
 * How far ahead of the server clock a sample's own timestamp is still
 * trusted, rather than treated as implausible and rejected outright.
 *
 * `sample.time` comes from the RTU's clock, not the server's
 * (`apps/ingest/src/adapters/mqtt.ts`'s header: "The pilot RTU makes the
 * point concrete: its clock ran ~34 minutes ahead of the server on
 * 2026-08-06.") A one-sided `now - sampleTime <= MAX_RAISE_SAMPLE_AGE_MS`
 * check treats every future-dated sample as infinitely fresh, since the
 * difference is negative — re-opening exactly the security-review hole this
 * gate exists to close, off a different input, for a condition this repo has
 * already measured on real hardware. Deliberately wider than
 * `MAX_RAISE_SAMPLE_AGE_MS`, not equal to it: an equal, symmetric bound would
 * reject the documented pilot RTU's genuinely live readings as "too far in
 * the future" during ordinary operation.
 *
 * This bounds the damage; it does not remove the dependency on a device
 * clock — clamping at the ingest sink is tracked separately (`F1.7`,
 * `docs/BACKLOG.md`, referenced from `telemetry-reading.schema.ts`'s `F4.37`
 * note) and is a §10 gate decision, not this function's job.
 */
export const MAX_RAISE_CLOCK_SKEW_MS = 60 * 60 * 1000;

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
 * off stale data.
 *
 * `F3.10` (ADR 0057 decision 2, migration `0066`) removed the second half of
 * that finding: acknowledging an alarm no longer frees the dedupe key
 * `alarms_open_per_rule_uidx` holds, so a repeated press cannot re-open the
 * same alarm. The gate is still the only thing standing between a 730-day-old
 * reading (ADR 0024 retention) and the first alarm of a new lifecycle.
 *
 * Two-sided, not one-sided: code review and security review both caught that
 * a future-dated sample defeats a `now - sampleTime <= MAX` check entirely
 * (the difference is negative, so it is always "fresh"). `NaN` (an invalid
 * date) fails both comparisons, so it stays rejected either way.
 */
export function isSampleFreshEnoughToRaise(sampleTime: Date, now: Date): boolean {
  const age = now.getTime() - sampleTime.getTime();
  return age >= -MAX_RAISE_CLOCK_SKEW_MS && age <= MAX_RAISE_SAMPLE_AGE_MS;
}

/** What `AlarmRaiser.raise` needs from a rule, regardless of which engine evaluated it. */
export type AlarmRaiseRule = AlarmMessageRule & {
  id: string;
  code: string;
  severity: string | null;
  /**
   * `E7.1b` — the rule's own organization (`automation_rules.organization_id`,
   * source of the `rule_executions` row's org). Compared against the asset's org
   * to catch a rule pointing at an asset in another tenant; `null` on a rule the
   * `0046` backfill has not reached.
   */
  organizationId: string | null;
};

export type AlarmRaiseResult = {
  /** `false` when the rule is already open for this asset — the dedupe fired. */
  raised: boolean;
  alarmId: string | null;
  /**
   * `F3.7` (plan D1): what `bms.alarms.severity` / `message` hold, or would
   * have — computed before any write, so they are reported on a dedupe and on
   * a refused raise too. The callers build the notification from these rather
   * than recomputing `defaultAlarmSeverity` / `composeAlarmMessage`, so the
   * notification text is the alarm text by construction and the dedupe key
   * carries the *defaulted* severity. This widens the raiser's report, not its
   * input (ADR 0041 decision 9); the raiser still notifies nobody.
   */
  severity: string;
  message: string;
};

/**
 * The one writer of `bms.alarms` (F3.6 / ADR 0033).
 *
 * Every engine — the streaming threshold cache (`AlarmEngineService`,
 * task 4), the on-demand evaluator (`RulesService.evaluateEnabledRules`,
 * task 5) and, since `F3.11`, the worker's `RuleSweepService` (ADR 0064) —
 * calls this instead of inserting directly, so a shared condition raises
 * exactly one open alarm no matter which path reaches it first.
 *
 * **It tells the sockets nothing directly** (ADR 0064 decision 4). The raise
 * announces itself with `pg_notify('bms_alarms', …)` as the last statement of
 * its own tenant transaction — ids only, `alarm-notify-channel.ts` — and
 * Postgres delivers a transactional `NOTIFY` on commit and drops it on
 * rollback, so a refused, deduped or rolled-back raise notifies nobody. The
 * `created` broadcast is the listener's: `AlarmNotifyService` in
 * `AlarmsModule` runs `LISTEN bms_alarms` in every API process and calls the
 * gateway's `broadcastCreated` from there (Unit 3). That is what lets
 * `AlarmRaiseModule` be loop-free and live on the worker without a gateway,
 * and what makes a raise on the worker reach the sockets of both API
 * processes.
 *
 * The dedupe is `alarms_open_per_rule_uidx` (migration 0032), enforced by the
 * database, not by a SELECT-then-INSERT read here: `ensureAlarm`'s pre-merge
 * shape did open → insert with nothing between them, so two concurrent
 * reading batches could both see nothing open and both insert — a real race,
 * not a hypothetical one. `.onConflictDoNothing()` is called with no target,
 * emitting a bare `ON CONFLICT DO NOTHING` — Postgres' partial-index arbiter
 * inference requires the ON CONFLICT predicate to *imply* the index's, and
 * `cleared_at IS NULL` alone does not imply `... AND rule_id IS NOT NULL`, so
 * a targeted clause here would risk "no unique or exclusion constraint
 * matching" on some plans. The bare form matches any constraint the row could
 * violate and needs no such proof.
 *
 * **What that index means changed with `F3.10`.** Migration `0066` (ADR 0057
 * decision 2) moved its predicate from `acknowledged_at IS NULL` to
 * `cleared_at IS NULL`, so "already open" now means "not yet cleared". An
 * acknowledged alarm whose condition still holds is deduped like any other
 * open one — it does not re-raise on the next evaluation, which it did before
 * — and a new row for the same `(asset_id, rule_id)` opens only after
 * `AlarmLifecycleService` has cleared the previous one and the condition
 * breaches again. Nothing in this class encodes that: the predicate is the
 * database's, which is why `alarm-raise.integration.spec.ts` proves it.
 */
@Injectable()
export class AlarmRaiser {
  private readonly logger = new Logger(AlarmRaiser.name);

  constructor(@Inject(TENANT_DRIZZLE) private readonly db: BmsDb) {}

  /**
   * @param organizationId the asset's organization — the tenant the alarm is
   *   filed under (`alarms.organization_id`) and the org the whole write runs
   *   inside via `withTenant`. Every engine derives it from the asset, since
   *   none carries a JWT.
   * @param opts.recordTrace Default `true` — writes one `bms.rule_executions`
   *   row on a successful raise (ADR 0033 decision 3). `RulesService`'s
   *   on-demand evaluator (task 5) passes `false`: it already writes a richer
   *   trace for every rule it evaluates, matched or not, and this insert
   *   would otherwise duplicate it. `AlarmEngineService`'s streaming path has
   *   no other mechanism to record why an alarm fired, so it takes the
   *   default; so does the worker's sweep (ADR 0064 decision 5).
   * @param opts.raisedBy Default `"alarm_engine"` — what the trace's
   *   `raisedBy` reads, so an operator asking "why did this alarm fire" can
   *   tell a sweep raise (`"rule_sweep"`) from a streaming one, and both from
   *   a press, whose trace carries `evaluatedBy` instead. It names the trace
   *   only: it never forces one under `recordTrace: false`, and it does not
   *   reach the `NOTIFY` payload, which is ids only.
   *
   * A successful raise ends with `pg_notify` inside the same transaction, so
   * the announcement commits with the row or not at all; nothing is
   * broadcast from here after commit — see the class doc.
   */
  async raise(
    assetId: string,
    organizationId: string,
    rule: AlarmRaiseRule,
    value: number,
    opts: { recordTrace?: boolean; raisedBy?: "alarm_engine" | "rule_sweep" } = {},
  ): Promise<AlarmRaiseResult> {
    // Above the guard, not below it: both are pure and both are part of the
    // result on every path (F3.7 D1), refused or deduped included.
    const severity = defaultAlarmSeverity(rule.severity);
    const message = composeAlarmMessage(rule, value);

    // E7.1b: a threshold rule must watch an asset in its own tenant. The assets
    // service permits a cross-org relocation, so an asset can move out from
    // under a rule still pointing at it — at which point alarms.org (the asset,
    // 0046) and rule_executions.org (the rule, 0046) diverge. Raising anyway
    // would file the alarm into a different tenant than its own trace, so refuse
    // and log rather than misfile it. A null rule org (pre-backfill) is not a
    // mismatch.
    if (rule.organizationId && rule.organizationId !== organizationId) {
      this.logger.warn(
        `alarm raise skipped for rule ${rule.id} on asset ${assetId}: rule org ` +
          `${rule.organizationId} != asset org ${organizationId}`,
      );
      return { raised: false, alarmId: null, severity, message };
    }

    // One tenant transaction: the dedupe insert, the trace and the NOTIFY all
    // run inside withTenant(asset org) so every write satisfies the 0047 policy.
    // Nothing is announced from outside it — a transactional NOTIFY commits
    // with the row or is dropped with it, so a rolled-back transaction cannot
    // announce an alarm that does not exist (ADR 0064 decision 4).
    const outcome = await withTenant(this.db, organizationId, async (tx) => {
      const inserted = await tx
        .insert(alarms)
        .values({
          organizationId,
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
        // Already active (raised, not yet cleared) for this (asset, rule) —
        // the dedupe, not a failure. No trace, no NOTIFY.
        return { raised: false as const, alarmId: null as string | null };
      }

      // Traced only on a raise (ADR 0033 decision 3) — bms.rule_executions has
      // no retention policy, and an every-evaluation trace is (readings × rules)
      // rows per batch. Skippable — see the `recordTrace` doc above. Its org is
      // the rule's (rule_executions.org resolves via rule_id, 0046), which the
      // guard above has proven equal to the asset org this GUC is set to.
      //
      // `raisedBy`, not `source`: code review caught that `source` here and
      // `RulesService.evaluateEnabledRules`'s own trace insert
      // (`source: row.source`, `automation_rules.source` — `operator_rule` /
      // `simulator_threshold` / `phe_alarm_seed`) would otherwise write the same
      // JSON key with two disjoint vocabularies into the same table, readable
      // only by which engine happened to reach the rule.
      if (opts.recordTrace ?? true) {
        await tx.insert(ruleExecutions).values({
          organizationId: rule.organizationId ?? organizationId,
          ruleId: rule.id,
          status: "matched",
          matched: true,
          observedValue: value,
          message,
          trace: { assetId, alarmId: row.id, raisedBy: opts.raisedBy ?? "alarm_engine" },
        });
      }

      // The announcement, last, and outside the `recordTrace` guard: the
      // on-demand press raises with `recordTrace: false` and its alarm still
      // has to reach the sockets. Both arguments are bound parameters — the
      // channel name and the payload never enter the SQL text. `pg_notify`
      // needs no grant (a channel name is not a schema object), and
      // `alarm-raise.service.rls.integration.test.ts` runs this as
      // `bms_tenant`, which is the gate that it needs none.
      await tx.execute(
        sql`select pg_notify(${ALARM_NOTIFY_CHANNEL}, ${encodeAlarmNotification({
          type: "created",
          alarmId: row.id,
          organizationId,
        })})`,
      );

      return { raised: true as const, alarmId: row.id };
    });

    return { raised: outcome.raised, alarmId: outcome.alarmId, severity, message };
  }
}
