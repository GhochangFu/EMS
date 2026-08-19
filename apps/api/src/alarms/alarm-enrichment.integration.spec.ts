import { NotFoundException } from "@nestjs/common";
import { is, sql, TransactionRollbackError } from "drizzle-orm";

import {
  alarmAffectedAssets,
  alarmEnrichments,
  alarmSkills,
  alarms,
  assets,
  automationRules,
  pointValues,
} from "@bms/db";
import type { BmsDb } from "@bms/db";

import { AlarmDetailsService } from "./alarm-details.service";

/**
 * `E2.1` (ADR 0034) — the enrichment schema against a real database.
 *
 * Every assertion runs inside its own transaction, ended with `tx.rollback()`
 * — the same reason `F3.6`'s suite gives: getting delete ordering right by
 * hand across `bms.alarm_affected_assets` → `bms.alarm_enrichments` →
 * `bms.alarms` → `bms.automation_rules` is exactly the kind of bookkeeping a
 * transaction already does for free. `db.transaction`'s node-postgres
 * implementation re-throws whatever the callback throws (`ROLLBACK` first,
 * `throw error` after) — `tx.rollback()`'s `TransactionRollbackError` is the
 * one exception that means success here, so it is the only one swallowed.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function firstSeededAssetId(db: BmsDb): Promise<string> {
  const [asset] = await db.select({ id: assets.id }).from(assets).limit(1);
  if (!asset) {
    throw new Error("no seeded asset available — run pnpm db:seed first");
  }
  return asset.id;
}

async function insertTestAlarm(db: BmsDb, assetId: string, code: string): Promise<string> {
  const [rule] = await db
    .insert(automationRules)
    .values({
      code,
      name: `E2.1 integration test — ${code}`,
      category: "safety",
      ruleType: "threshold",
      assetId,
      pointKey: "e21_test_point",
      operator: "gte",
      thresholdValue: 999_999,
      severity: "warning",
    })
    .returning({ id: automationRules.id });
  if (!rule) {
    throw new Error(`failed to insert test rule ${code}`);
  }
  const [alarm] = await db
    .insert(alarms)
    .values({
      assetId,
      ruleId: rule.id,
      severity: "warning",
      message: `E2.1 integration test alarm — ${code}`,
    })
    .returning({ id: alarms.id });
  if (!alarm) {
    throw new Error(`failed to insert test alarm ${code}`);
  }
  return alarm.id;
}

/** A second seeded asset, distinct from `firstSeededAssetId`, for out-of-scope cases. */
async function secondSeededAssetId(db: BmsDb, excludeId: string): Promise<string> {
  const [asset] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(sql`${assets.id} != ${excludeId}`)
    .limit(1);
  if (!asset) {
    throw new Error("need at least two seeded assets — run pnpm db:seed first");
  }
  return asset.id;
}

/** An alarm with no linked rule — a historical alarm, or one raised outside the rule engine. */
async function insertTestAlarmWithoutRule(db: BmsDb, assetId: string, code: string): Promise<string> {
  const [alarm] = await db
    .insert(alarms)
    .values({
      assetId,
      ruleId: null,
      severity: "warning",
      message: `E2.1 integration test alarm (no rule) — ${code}`,
    })
    .returning({ id: alarms.id });
  if (!alarm) {
    throw new Error(`failed to insert test alarm ${code}`);
  }
  return alarm.id;
}

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

/** `bms.alarm_skills` seeds the five trades, active, from migration `0034`. */
export async function assertAlarmSkillsSeeded(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const rows = await tx
      .select({ code: alarmSkills.code, active: alarmSkills.active })
      .from(alarmSkills);
    const codes = rows.map((r) => r.code).sort();
    assert(
      ["civil", "controls", "electrical", "hvac", "mechanical"].every((c) => codes.includes(c)),
      `expected the five seeded skill codes, got: ${codes.join(", ")}`,
    );
    assert(
      rows.every((r) => r.active),
      "every seeded skill must be active",
    );
    tx.rollback();
  });
}

/**
 * Postgres SQLSTATE the failing branch must throw — narrower than "it threw",
 * so a broken import (`TypeError`, no `.code`) or a missing table
 * (`42P01`, undefined_table) cannot pass this test for the wrong reason.
 */
function pgErrorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code?: string }).code
    : undefined;
}

/** `bms.alarm_enrichments.alarm_id` is UNIQUE — one enrichment per alarm. */
export async function assertOneEnrichmentPerAlarm(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const alarmId = await insertTestAlarm(tx, assetId, "E21_TEST_ONE_ENRICHMENT");

    await tx.insert(alarmEnrichments).values({ alarmId, rootCause: "first" });

    let code: string | undefined;
    try {
      await tx.insert(alarmEnrichments).values({ alarmId, rootCause: "second" });
    } catch (err) {
      code = pgErrorCode(err);
    }
    assert(
      code === "23505",
      `a second enrichment row for the same alarm_id must violate the UNIQUE constraint (23505), got ${code ?? "no error"}`,
    );

    tx.rollback();
  });
}

/** `bms.alarm_affected_assets` — `UNIQUE (enrichment_id, asset_id)`. */
export async function assertAffectedAssetPairUnique(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const alarmId = await insertTestAlarm(tx, assetId, "E21_TEST_AFFECTED_UNIQUE");
    const [enrichment] = await tx
      .insert(alarmEnrichments)
      .values({ alarmId })
      .returning({ id: alarmEnrichments.id });
    if (!enrichment) {
      throw new Error("failed to insert test enrichment");
    }

    await tx.insert(alarmAffectedAssets).values({ enrichmentId: enrichment.id, assetId });

    let code: string | undefined;
    try {
      await tx.insert(alarmAffectedAssets).values({ enrichmentId: enrichment.id, assetId });
    } catch (err) {
      code = pgErrorCode(err);
    }
    assert(
      code === "23505",
      `the same (enrichment_id, asset_id) pair must violate the UNIQUE constraint (23505), got ${code ?? "no error"}`,
    );

    tx.rollback();
  });
}

/** `bms.alarm_enrichments.skill_code` rejects a code `bms.alarm_skills` does not declare. */
export async function assertUndeclaredSkillRejected(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const alarmId = await insertTestAlarm(tx, assetId, "E21_TEST_UNDECLARED_SKILL");

    let code: string | undefined;
    try {
      await tx.insert(alarmEnrichments).values({ alarmId, skillCode: "not_a_real_skill" });
    } catch (err) {
      code = pgErrorCode(err);
    }
    assert(
      code === "23503",
      `an undeclared skill_code must be rejected by the foreign key (23503), got ${code ?? "no error"}`,
    );

    tx.rollback();
  });
}

// ---------------------------------------------------------------------------
// GET /api/v1/alarms/:id/details (ADR 0034 decision 5)
// ---------------------------------------------------------------------------

/** An alarm with a linked threshold rule returns the value-vs-threshold pairing. */
export async function assertDetailsReturnsThresholdPairing(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const alarmId = await insertTestAlarm(tx, assetId, "E21_TEST_DETAILS_THRESHOLD");
    await tx.insert(pointValues).values({
      time: new Date("2026-08-19T10:00:00Z"),
      assetId,
      pointKey: "e21_test_point",
      value: 42,
      unit: "kW",
    });

    const details = await new AlarmDetailsService(tx).get(alarmId, null);
    assert(
      details.thresholdOperator === "gte" && details.thresholdValue === 999_999,
      `expected the linked rule's operator/threshold, got ${details.thresholdOperator} ${details.thresholdValue}`,
    );
    assert(
      details.currentValue === 42 && details.currentValueUnit === "kW",
      `expected the latest sample, got ${details.currentValue} ${details.currentValueUnit}`,
    );
    assert(details.currentValueAt != null, "expected the sample's timestamp");

    tx.rollback();
  });
}

/** An alarm with no linked rule returns nulls for the pairing, not a failure. */
export async function assertDetailsOmitsPairingWhenNoRule(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const alarmId = await insertTestAlarmWithoutRule(tx, assetId, "E21_TEST_DETAILS_NO_RULE");

    const details = await new AlarmDetailsService(tx).get(alarmId, null);
    assert(
      details.thresholdOperator === null &&
        details.thresholdValue === null &&
        details.currentValue === null,
      "expected the threshold/current-value block to be null together when rule_id IS NULL",
    );

    tx.rollback();
  });
}

/**
 * An alarm outside the caller's asset scope is not found — matching
 * `AlarmsService.acknowledge`'s posture (`NotFoundException`, not a 403 that
 * would confirm the alarm exists).
 */
export async function assertDetailsScopedByAssetIds(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const otherAssetId = await secondSeededAssetId(tx, assetId);
    const alarmId = await insertTestAlarm(tx, assetId, "E21_TEST_DETAILS_SCOPE");

    let notFound = false;
    try {
      await new AlarmDetailsService(tx).get(alarmId, [otherAssetId]);
    } catch (err) {
      notFound = err instanceof NotFoundException;
    }
    assert(notFound, "an alarm outside the caller's assetIds must raise NotFoundException");

    tx.rollback();
  });
}

/** An empty assetIds array (zero-asset scope) raises not-found without querying. */
export async function assertDetailsEmptyScopeThrows(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const alarmId = await insertTestAlarm(tx, assetId, "E21_TEST_DETAILS_EMPTY_SCOPE");

    let notFound = false;
    try {
      await new AlarmDetailsService(tx).get(alarmId, []);
    } catch (err) {
      notFound = err instanceof NotFoundException;
    }
    assert(notFound, "an empty assetIds scope must raise NotFoundException, matching AlarmsService.list");

    tx.rollback();
  });
}

/** Affected assets come back when in scope; an out-of-scope one is filtered, not leaked. */
export async function assertDetailsFiltersAffectedAssetsByScope(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const inScopeAffected = await secondSeededAssetId(tx, assetId);
    const alarmId = await insertTestAlarm(tx, assetId, "E21_TEST_DETAILS_AFFECTED_SCOPE");
    const [enrichment] = await tx
      .insert(alarmEnrichments)
      .values({ alarmId, rootCause: "test" })
      .returning({ id: alarmEnrichments.id });
    if (!enrichment) {
      throw new Error("failed to insert test enrichment");
    }
    await tx
      .insert(alarmAffectedAssets)
      .values([{ enrichmentId: enrichment.id, assetId: inScopeAffected }]);

    // Caller's scope is [assetId] only — the alarm's own asset, not the
    // affected one — so the affected asset must be filtered out of the result.
    const details = await new AlarmDetailsService(tx).get(alarmId, [assetId]);
    assert(
      details.enrichment?.affectedAssets.length === 0,
      `expected the out-of-scope affected asset to be filtered, got ${details.enrichment?.affectedAssets.length}`,
    );

    tx.rollback();
  });
}
