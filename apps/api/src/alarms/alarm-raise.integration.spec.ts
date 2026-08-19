import { and, eq, is, isNull, TransactionRollbackError } from "drizzle-orm";

import { alarms, alarmSeverities, assets, automationRules, ruleExecutions } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { AlarmRaiseRule } from "./alarm-raise.service";
import { AlarmRaiser } from "./alarm-raise.service";
import type { AlarmsGateway } from "./alarms.gateway";

/**
 * `F3.6` — `AlarmRaiser` against a real database.
 *
 * Every assertion runs inside its own transaction, ended with `tx.rollback()`
 * rather than a manual `DELETE` — the same reason `F4.32`'s finite-value-check
 * suite gives: `alarms_rule_id_fk` (migration 0032, `NO ACTION`) means deleting
 * a test rule ahead of its alarms fails, and getting that ordering right by
 * hand is exactly the kind of bookkeeping a transaction already does for free.
 * `db.transaction`'s node-postgres implementation re-throws whatever the
 * callback throws (`ROLLBACK` first, `throw error` after) — `tx.rollback()`'s
 * `TransactionRollbackError` is the one exception that means success here, so
 * it is the only one swallowed.
 *
 * The gateway is a minimal stub (`broadcastCreated` only) rather than a real
 * `AlarmsGateway` — matching how `access-control.integration.test.ts`
 * constructs its service with `new`, not through a Nest testing module.
 * `AlarmRaiser.raise` calls `broadcastCreated` for real when the insert
 * succeeds, so the stub has to be a working no-op, not `{}`.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function stubGateway(): AlarmsGateway {
  return { broadcastCreated: () => undefined } as unknown as AlarmsGateway;
}

async function firstSeededAssetId(db: BmsDb): Promise<string> {
  const [asset] = await db.select({ id: assets.id }).from(assets).limit(1);
  if (!asset) {
    throw new Error("no seeded asset available to attach a test rule to — run pnpm db:seed first");
  }
  return asset.id;
}

async function insertTestRule(
  db: BmsDb,
  overrides: { code: string; pointKey: string; severity: string; assetId: string },
): Promise<AlarmRaiseRule> {
  const [row] = await db
    .insert(automationRules)
    .values({
      code: overrides.code,
      name: `F3.6 integration test — ${overrides.code}`,
      category: "safety",
      ruleType: "threshold",
      assetId: overrides.assetId,
      pointKey: overrides.pointKey,
      operator: "gte",
      // Deliberately unreachable by any real telemetry sample, so this rule
      // can never be matched by the live simulator concurrently with the test.
      thresholdValue: 999_999,
      severity: overrides.severity,
    })
    .returning({ id: automationRules.id, code: automationRules.code });

  if (!row) {
    throw new Error(`failed to insert test rule ${overrides.code}`);
  }

  return {
    id: row.id,
    code: row.code,
    severity: overrides.severity,
    name: `F3.6 integration test — ${overrides.code}`,
    pointKey: overrides.pointKey,
    alarmMessage: null,
    unit: null,
  };
}

async function withRollback(
  db: BmsDb,
  run: Parameters<BmsDb["transaction"]>[0],
): Promise<void> {
  await db.transaction(run).catch((err: unknown) => {
    // `is()`, not `instanceof`: pnpm can resolve `drizzle-orm` to more than one
    // physical copy across the workspace, and `TransactionRollbackError` thrown
    // by the copy inside `db.transaction` then fails an `instanceof` check
    // against the class this file imports — `is()` compares the entity-kind
    // brand instead of the constructor identity, which is exactly the problem
    // it exists to solve. Caught the hard way: this test failed with the
    // deliberate `tx.rollback()` itself reported as an unhandled error before
    // the fix.
    if (!is(err, TransactionRollbackError)) {
      throw err;
    }
  });
}

/**
 * The dedupe (`alarms_open_per_rule_uidx`) and decision 3 (a `rule_executions`
 * row only on a successful raise) in one pass — both share the same two-raise
 * setup, and decision 3 needs to observe the deduped second raise adding no
 * trace, not just that the first one adds exactly one.
 */
export async function assertRaisesDedupesAndTracesOnlyOnRaise(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const rule = await insertTestRule(tx, {
      code: "F36_TEST_RAISE_DEDUPE",
      pointKey: "f36_test_dedupe_point",
      severity: "warning",
      assetId,
    });
    const raiser = new AlarmRaiser(tx, stubGateway());

    const first = await raiser.raise(assetId, rule, 1_000_000);
    assert(first.raised, "the first raise for a fresh (asset, rule) must succeed");
    assert(first.alarmId !== null, "a successful raise returns the alarm id");

    const openAfterFirst = await tx
      .select({ id: alarms.id })
      .from(alarms)
      .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, rule.id), isNull(alarms.acknowledgedAt)));
    assert(
      openAfterFirst.length === 1,
      `expected exactly 1 open alarm after the first raise, found ${openAfterFirst.length}`,
    );

    const second = await raiser.raise(assetId, rule, 1_000_001);
    assert(
      !second.raised,
      "raising the same open (asset, rule) again must dedupe via alarms_open_per_rule_uidx, not insert a second row",
    );
    assert(second.alarmId === null, "a deduped raise returns no alarm id");

    const openAfterSecond = await tx
      .select({ id: alarms.id })
      .from(alarms)
      .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, rule.id), isNull(alarms.acknowledgedAt)));
    assert(
      openAfterSecond.length === 1,
      `the dedupe must not have inserted a second row, found ${openAfterSecond.length}`,
    );

    const traces = await tx
      .select({ id: ruleExecutions.id })
      .from(ruleExecutions)
      .where(eq(ruleExecutions.ruleId, rule.id));
    assert(
      traces.length === 1,
      `ADR 0033 decision 3: expected exactly 1 rule_executions row (raise only), found ${traces.length} — ` +
        "the deduped second raise must not add a second trace",
    );

    tx.rollback();
  });
}

/**
 * ADR 0032's headline promise, proven end-to-end rather than at the unit
 * level: a severity added to the vocabulary by a plain `INSERT` — the shape
 * client ask `B9` would take — survives a real raise unchanged. This is the
 * exact regression the migration review caught before ADR 0032 merged, now
 * asserted through the path that actually writes `bms.alarms.severity`.
 */
export async function assertPreservesSeededSeverity(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    await tx
      .insert(alarmSeverities)
      .values({ code: "high", label: "High", tone: "warning", rank: 25 })
      .onConflictDoNothing();

    const assetId = await firstSeededAssetId(tx);
    const rule = await insertTestRule(tx, {
      code: "F36_TEST_RAISE_HIGH_SEVERITY",
      pointKey: "f36_test_high_point",
      severity: "high",
      assetId,
    });
    const raiser = new AlarmRaiser(tx, stubGateway());

    const result = await raiser.raise(assetId, rule, 1_000_000);
    assert(result.raised, "raising a rule with a non-default seeded severity must succeed");

    const [row] = await tx
      .select({ severity: alarms.severity })
      .from(alarms)
      .where(eq(alarms.id, result.alarmId as string));
    assert(
      row?.severity === "high",
      `expected severity 'high' to survive the raise unchanged, got '${row?.severity ?? "undefined"}'`,
    );

    tx.rollback();
  });
}
