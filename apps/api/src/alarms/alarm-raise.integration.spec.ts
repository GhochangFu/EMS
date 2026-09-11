import { and, eq, is, isNull, TransactionRollbackError } from "drizzle-orm";

import { alarms, alarmSeverities, automationRules, ruleExecutions } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { AlarmRaiseRule } from "./alarm-raise.service";
import { AlarmRaiser } from "./alarm-raise.service";
import { createFixtureAssets, fixtureLocation } from "../testing/integration-fixtures";

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
 * The fixture asset is built inside that transaction rather than read off the
 * seed with `SELECT id FROM bms.assets LIMIT 1`, which was flaky under a full
 * parallel run — see `../testing/integration-fixtures.ts` for the mechanism.
 *
 * `AlarmRaiser` is constructed with `new` and the transaction handle alone —
 * matching how `access-control.integration.test.ts` constructs its service,
 * not through a Nest testing module. It takes no gateway: since `F3.11`
 * (ADR 0064 decision 4) a raise announces itself with a transactional
 * `pg_notify('bms_alarms', …)` as the last statement of its own transaction,
 * and the `created` broadcast comes from the `LISTEN bms_alarms` path
 * (`AlarmNotifyService`, Unit 3). Every row here rolls back, so the `NOTIFY`
 * each successful raise issues is dropped with the row — which still proves
 * the statement parses and binds on a real connection; that it reaches a
 * listener needs a commit and is Unit 8's integration spec.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function insertTestRule(
  db: BmsDb,
  overrides: {
    code: string;
    pointKey: string;
    severity: string;
    assetId: string;
    organizationId: string;
  },
): Promise<AlarmRaiseRule> {
  const [row] = await db
    .insert(automationRules)
    .values({
      code: overrides.code,
      name: `F3.6 integration test — ${overrides.code}`,
      category: "safety",
      ruleType: "threshold",
      organizationId: overrides.organizationId,
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
    organizationId: overrides.organizationId,
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
 *
 * `F3.10` / ADR 0057 decision 2 extends the same fixture with the lifecycle
 * pair, because it is the same dedupe seen from the other side: migration
 * `0066` moved the index predicate from `acknowledged_at IS NULL` to
 * `cleared_at IS NULL`, so acknowledging no longer frees the key. Two raises
 * are therefore not enough — the acknowledged alarm must still refuse a raise,
 * and only clearing it may let a new row open.
 */
export async function assertRaisesDedupesAndTracesOnlyOnRaise(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F36", loc);
    const rule = await insertTestRule(tx, {
      code: "F36_TEST_RAISE_DEDUPE",
      pointKey: "f36_test_dedupe_point",
      severity: "warning",
      assetId,
      organizationId: loc.organizationId,
    });
    const raiser = new AlarmRaiser(tx);

    const first = await raiser.raise(assetId, loc.organizationId, rule, 1_000_000);
    assert(first.raised, "the first raise for a fresh (asset, rule) must succeed");
    assert(first.alarmId !== null, "a successful raise returns the alarm id");

    const openAfterFirst = await tx
      .select({ id: alarms.id })
      .from(alarms)
      .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, rule.id), isNull(alarms.clearedAt)));
    assert(
      openAfterFirst.length === 1,
      `expected exactly 1 open alarm after the first raise, found ${openAfterFirst.length}`,
    );

    const second = await raiser.raise(assetId, loc.organizationId, rule, 1_000_001);
    assert(
      !second.raised,
      "raising the same open (asset, rule) again must dedupe via alarms_open_per_rule_uidx, not insert a second row",
    );
    assert(second.alarmId === null, "a deduped raise returns no alarm id");

    const openAfterSecond = await tx
      .select({ id: alarms.id })
      .from(alarms)
      .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, rule.id), isNull(alarms.clearedAt)));
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

    // `F3.10` / ADR 0057 decision 2, first half. Acknowledging is an annotation
    // now, so it must NOT free the dedupe key. Before migration `0066` this
    // third raise opened a second alarm — the behaviour the `F3.46` stack run
    // measured (acknowledge, press *Evaluate now*, a new alarm appears).
    await tx
      .update(alarms)
      .set({ acknowledgedAt: new Date() })
      .where(eq(alarms.id, first.alarmId as string));

    const afterAck = await raiser.raise(assetId, loc.organizationId, rule, 1_000_002);
    assert(
      !afterAck.raised,
      "an acknowledged alarm whose condition still holds must NOT re-raise — the index " +
        "predicate is cleared_at IS NULL since 0066, not acknowledged_at IS NULL",
    );
    const rowsAfterAck = await tx
      .select({ id: alarms.id })
      .from(alarms)
      .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, rule.id)));
    assert(
      rowsAfterAck.length === 1,
      `the acknowledged alarm must still be the only row, found ${rowsAfterAck.length}`,
    );

    // Second half: clearing is what frees the key. A condition that breaches
    // again after the sweep cleared the alarm opens a genuinely new row — and,
    // being a real raise, it traces (ADR 0033 decision 3 again).
    await tx
      .update(alarms)
      .set({ clearedAt: new Date() })
      .where(eq(alarms.id, first.alarmId as string));

    const afterClear = await raiser.raise(assetId, loc.organizationId, rule, 1_000_003);
    assert(
      afterClear.raised,
      "once the previous alarm is cleared, the same condition must open a new alarm",
    );
    assert(
      afterClear.alarmId !== null && afterClear.alarmId !== first.alarmId,
      "the post-clear raise must be a new row, not the cleared one",
    );
    const rowsAfterClear = await tx
      .select({ id: alarms.id })
      .from(alarms)
      .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, rule.id)));
    assert(
      rowsAfterClear.length === 2,
      `expected the cleared row plus the new one, found ${rowsAfterClear.length}`,
    );
    const openAfterClear = await tx
      .select({ id: alarms.id })
      .from(alarms)
      .where(and(eq(alarms.assetId, assetId), eq(alarms.ruleId, rule.id), isNull(alarms.clearedAt)));
    assert(
      openAfterClear.length === 1,
      `exactly one alarm may be active per (asset, rule), found ${openAfterClear.length}`,
    );

    const tracesAfterClear = await tx
      .select({ id: ruleExecutions.id })
      .from(ruleExecutions)
      .where(eq(ruleExecutions.ruleId, rule.id));
    assert(
      tracesAfterClear.length === 2,
      `expected 2 rule_executions rows (one per real raise), found ${tracesAfterClear.length}`,
    );

    // Every row above lives inside this transaction; the rollback restores the
    // database, alarms, rule and traces together.
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

    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F36", loc);
    const rule = await insertTestRule(tx, {
      code: "F36_TEST_RAISE_HIGH_SEVERITY",
      pointKey: "f36_test_high_point",
      severity: "high",
      assetId,
      organizationId: loc.organizationId,
    });
    const raiser = new AlarmRaiser(tx);

    const result = await raiser.raise(assetId, loc.organizationId, rule, 1_000_000);
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

/**
 * `F3.11` / ADR 0064 decision 5 — the trace names which engine raised.
 *
 * Three rows on the same fixture, each its own transaction and each its own
 * `it()` in the wrapper, because `assert` throws and the plan's mutation
 * (hard-code `"alarm_engine"`) has to redden the `rule_sweep` row and no
 * other. Every row also executes the `pg_notify` the raise now issues inside
 * its rolled-back transaction — that is the gate that the statement parses
 * and binds under a real connection; the `NOTIFY`-reaches-the-listener claim
 * needs a commit and is Unit 8's.
 */
async function readSingleTrace(
  tx: Parameters<Parameters<BmsDb["transaction"]>[0]>[0],
  ruleId: string,
): Promise<Record<string, unknown>> {
  const traces = await tx
    .select({ trace: ruleExecutions.trace })
    .from(ruleExecutions)
    .where(eq(ruleExecutions.ruleId, ruleId));
  assert(traces.length === 1, `expected exactly 1 rule_executions row, found ${traces.length}`);
  const trace = traces[0]?.trace;
  assert(
    trace !== null && typeof trace === "object" && !Array.isArray(trace),
    `expected the trace to be a JSON object, got ${JSON.stringify(trace)}`,
  );
  return trace as Record<string, unknown>;
}

/** No `opts` at all — the streaming engine's call shape — traces `raisedBy: "alarm_engine"` and no `evaluatedBy`. */
export async function assertDefaultTraceNamesTheStreamingEngine(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F36", loc);
    const rule = await insertTestRule(tx, {
      code: "F36_TEST_RAISE_TRACE_DEFAULT",
      pointKey: "f36_test_trace_default_point",
      severity: "warning",
      assetId,
      organizationId: loc.organizationId,
    });
    const raiser = new AlarmRaiser(tx);

    const result = await raiser.raise(assetId, loc.organizationId, rule, 1_000_000);
    assert(result.raised, "the raise must succeed for the trace row to exist");

    const trace = await readSingleTrace(tx, rule.id);
    assert(
      trace.raisedBy === "alarm_engine",
      `expected the default trace to read raisedBy "alarm_engine", got ${JSON.stringify(trace.raisedBy)}`,
    );
    assert(
      !("evaluatedBy" in trace),
      `an engine trace must carry no evaluatedBy key — nobody pressed anything; got ${JSON.stringify(trace)}`,
    );

    tx.rollback();
  });
}

/** `{ raisedBy: "rule_sweep" }` — the worker's sweep — is what the trace reads back. */
export async function assertRaisedByOptionReachesTheTrace(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F36", loc);
    const rule = await insertTestRule(tx, {
      code: "F36_TEST_RAISE_TRACE_SWEEP",
      pointKey: "f36_test_trace_sweep_point",
      severity: "warning",
      assetId,
      organizationId: loc.organizationId,
    });
    const raiser = new AlarmRaiser(tx);

    const result = await raiser.raise(assetId, loc.organizationId, rule, 1_000_000, {
      raisedBy: "rule_sweep",
    });
    assert(result.raised, "the raise must succeed for the trace row to exist");

    const trace = await readSingleTrace(tx, rule.id);
    assert(
      trace.raisedBy === "rule_sweep",
      `expected the sweep's trace to read raisedBy "rule_sweep", got ${JSON.stringify(trace.raisedBy)}`,
    );

    tx.rollback();
  });
}

/** `raisedBy` does not force a trace: `recordTrace: false` still writes none. */
export async function assertRaisedByDoesNotForceATrace(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const loc = await fixtureLocation(tx);
    const [assetId] = await createFixtureAssets(tx, 1, "F36", loc);
    const rule = await insertTestRule(tx, {
      code: "F36_TEST_RAISE_TRACE_NONE",
      pointKey: "f36_test_trace_none_point",
      severity: "warning",
      assetId,
      organizationId: loc.organizationId,
    });
    const raiser = new AlarmRaiser(tx);

    const result = await raiser.raise(assetId, loc.organizationId, rule, 1_000_000, {
      recordTrace: false,
      raisedBy: "rule_sweep",
    });
    assert(result.raised, "the raise itself must still succeed with recordTrace: false");

    const traces = await tx
      .select({ id: ruleExecutions.id })
      .from(ruleExecutions)
      .where(eq(ruleExecutions.ruleId, rule.id));
    assert(
      traces.length === 0,
      `recordTrace: false must write no rule_executions row whatever raisedBy says, found ${traces.length}`,
    );

    tx.rollback();
  });
}
