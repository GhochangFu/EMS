import { and, eq, is, TransactionRollbackError } from "drizzle-orm";

import { alarms, assets, automationRules, pointValues, ruleExecutions } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AlarmRaiser } from "../alarms/alarm-raise.service";
import type { AlarmsGateway } from "../alarms/alarms.gateway";
import { RulesService } from "./rules.service";
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

async function twoSeededAssetIds(db: BmsDb): Promise<[string, string]> {
  const rows = await db.select({ id: assets.id }).from(assets).limit(2);
  if (rows.length < 2 || !rows[0] || !rows[1]) {
    throw new Error("need at least 2 seeded assets — run pnpm db:seed first");
  }
  return [rows[0].id, rows[1].id];
}

async function insertMatchingFixture(
  db: BmsDb,
  assetId: string,
  suffix: string,
): Promise<{ ruleId: string }> {
  const pointKey = `f36_task5_test_point_${suffix}`;
  await db.insert(pointValues).values({
    time: new Date(),
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
    const [assetA, assetB] = await twoSeededAssetIds(tx);
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
