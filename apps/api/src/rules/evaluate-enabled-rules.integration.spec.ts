import { and, eq, is, TransactionRollbackError } from "drizzle-orm";

import { alarms, automationRules, pointValues, ruleExecutions } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AlarmRaiser } from "../alarms/alarm-raise.service";
import type { AlarmsGateway } from "../alarms/alarms.gateway";
import { RulesService } from "./rules.service";
import { createFixtureAssets } from "../testing/integration-fixtures";
import type { VocabulariesService } from "../vocabularies/vocabularies.service";

/**
 * `F3.6` task 5 / ADR 0033 decision 2 — `evaluateEnabledRules` raises
 * unscoped even when the caller's `assetIds` narrows what comes back.
 *
 * Same isolation as `alarm-raise.integration.spec.ts`: one transaction per
 * assertion, ended with `tx.rollback()` rather than manual `DELETE` — the
 * `alarms_rule_id_fk` `NO ACTION` FK (migration 0032) means a test rule
 * cannot be deleted ahead of the alarm it raised, and a transaction already
 * orders that correctly by never committing either.
 *
 * Fixture assets are built inside that transaction rather than read off the
 * seed with `SELECT id FROM bms.assets LIMIT 2` — the read this file used to do
 * was recorded as a race in `vitest.config.ts` at `F2.5`, having failed once
 * with `automation_rules_asset_id_fkey` on a full parallel run. See
 * `../testing/integration-fixtures.ts`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function stubGateway(): AlarmsGateway {
  return { broadcastCreated: () => undefined } as unknown as AlarmsGateway;
}

function stubVocabularies(): VocabulariesService {
  return {
    assertRuleCategory: async () => undefined,
    assertAlarmSeverity: async () => undefined,
  } as unknown as VocabulariesService;
}

const ACTOR: Pick<JwtPayload, "sub" | "email"> = {
  sub: "00000000-0000-4000-8000-000000000000",
  email: "integration-test@bms.local",
};

async function withRollback(
  db: BmsDb,
  run: Parameters<BmsDb["transaction"]>[0],
): Promise<void> {
  await db.transaction(run).catch((err: unknown) => {
    if (!is(err, TransactionRollbackError)) {
      throw err;
    }
  });
}

async function insertMatchingFixture(
  db: BmsDb,
  assetId: string,
  suffix: string,
  sampleTime: Date = new Date(),
): Promise<{ ruleId: string }> {
  const pointKey = `f36_task5_test_point_${suffix}`;
  await db.insert(pointValues).values({
    time: sampleTime,
    assetId,
    pointKey,
    value: 600_000,
    unit: null,
  });

  const [rule] = await db
    .insert(automationRules)
    .values({
      code: `F36_TASK5_TEST_${suffix.toUpperCase()}`,
      name: `F3.6 task 5 integration test — ${suffix}`,
      category: "safety",
      ruleType: "threshold",
      assetId,
      pointKey,
      operator: "gte",
      thresholdValue: 500_000,
      severity: "warning",
    })
    .returning({ id: automationRules.id });

  if (!rule) {
    throw new Error(`failed to insert test rule for ${suffix}`);
  }
  return { ruleId: rule.id };
}

/**
 * The scope assertion (F3.6 task 5): a caller scoped to asset A only sees
 * asset A's execution in the response, but BOTH A's and B's rules raise —
 * proving the raise is unscoped while the returned list is not.
 */
export async function assertRaisesUnscopedButReturnsScoped(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const [assetA, assetB] = await createFixtureAssets(tx, 2, "F36T5");
    const a = await insertMatchingFixture(tx, assetA, "a");
    const b = await insertMatchingFixture(tx, assetB, "b");

    const service = new RulesService(tx, stubVocabularies(), new AlarmRaiser(tx, stubGateway()));

    const { items } = await service.evaluateEnabledRules(ACTOR, [assetA]);

    const returnedRuleIds = items.map((item) => item.ruleId);
    assert(
      returnedRuleIds.includes(a.ruleId),
      "the caller's own scoped rule must be in the returned trace list",
    );
    assert(
      !returnedRuleIds.includes(b.ruleId),
      "a rule outside the caller's assetIds must NOT be in the returned trace list",
    );

    // The raise, unlike the return value, must not respect assetIds — ADR
    // 0033 decision 2. Both assets must have an open alarm from their own
    // rule.
    const openAlarmIds = new Map<string, string>();
    for (const { ruleId, assetId, label } of [
      { ruleId: a.ruleId, assetId: assetA, label: "A (in scope)" },
      { ruleId: b.ruleId, assetId: assetB, label: "B (OUT of scope)" },
    ]) {
      const openAlarms = await tx
        .select({ id: alarms.id })
        .from(alarms)
        .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, ruleId)));
      assert(
        openAlarms.length === 1,
        `asset ${label} must have exactly 1 open alarm from its matched rule regardless of ` +
          `assetIds scope, found ${openAlarms.length}`,
      );
      const alarmRow = openAlarms[0];
      if (alarmRow) {
        openAlarmIds.set(ruleId, alarmRow.id);
      }
    }

    // Exactly one rule_executions row per rule — evaluateEnabledRules' own
    // per-evaluation trace, not doubled by AlarmRaiser's internal one
    // (raise(..., { recordTrace: false })) — and that one row's trace
    // actually carries the alarm it opened. Code review caught a draft where
    // the raise result was discarded and `alarmId` never reached the trace at
    // all; this is the regression guard.
    for (const { ruleId, label } of [
      { ruleId: a.ruleId, label: "A" },
      { ruleId: b.ruleId, label: "B" },
    ]) {
      const traces = await tx
        .select({ id: ruleExecutions.id, trace: ruleExecutions.trace })
        .from(ruleExecutions)
        .where(eq(ruleExecutions.ruleId, ruleId));
      assert(
        traces.length === 1,
        `rule ${label} must have exactly 1 rule_executions row (evaluateEnabledRules' own, ` +
          `not doubled by AlarmRaiser), found ${traces.length}`,
      );
      const trace = traces[0]?.trace as Record<string, unknown> | null;
      assert(
        trace?.alarmId === openAlarmIds.get(ruleId),
        `rule ${label}'s trace must carry the alarmId it opened (${openAlarmIds.get(ruleId)}), ` +
          `got ${JSON.stringify(trace?.alarmId)}`,
      );
    }

    tx.rollback();
  });
}

/**
 * Security review (F3.6): a sample far older than
 * `isSampleFreshEnoughToRaise`'s bound must still be reported as `matched`
 * in the trace (honest about what the fleet's last reading was), but must
 * NOT raise — and must not touch `bms.alarms` at all. This is the case an
 * asset that stopped reporting (offline RTU, decommissioned) exercises the
 * moment anyone presses "Evaluate now".
 */
export async function assertStaleSampleMatchesButDoesNotRaise(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const [assetId] = await createFixtureAssets(tx, 1, "F36T5");
    const staleTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day old
    const { ruleId } = await insertMatchingFixture(tx, assetId, "stale", staleTime);

    const service = new RulesService(tx, stubVocabularies(), new AlarmRaiser(tx, stubGateway()));
    await service.evaluateEnabledRules(ACTOR, [assetId]);

    const openAlarms = await tx
      .select({ id: alarms.id })
      .from(alarms)
      .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, ruleId)));
    assert(
      openAlarms.length === 0,
      `a stale sample must not raise an alarm, found ${openAlarms.length}`,
    );

    const traces = await tx
      .select({ status: ruleExecutions.status, matched: ruleExecutions.matched, trace: ruleExecutions.trace })
      .from(ruleExecutions)
      .where(eq(ruleExecutions.ruleId, ruleId));
    assert(traces.length === 1, `expected exactly 1 rule_executions row, found ${traces.length}`);
    const [traceRow] = traces;
    assert(
      traceRow?.status === "matched" && traceRow.matched === true,
      "the trace must still report the true (stale) match honestly, not silently downgrade to skipped",
    );
    const trace = traceRow?.trace as Record<string, unknown> | null;
    assert(
      trace?.alarmId === undefined,
      `a stale match must carry no alarmId in its trace, got ${JSON.stringify(trace?.alarmId)}`,
    );

    tx.rollback();
  });
}
