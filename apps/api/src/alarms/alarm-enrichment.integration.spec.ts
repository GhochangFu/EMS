import { is, TransactionRollbackError } from "drizzle-orm";

import { alarmAffectedAssets, alarmEnrichments, alarmSkills, alarms, assets, automationRules } from "@bms/db";
import type { BmsDb } from "@bms/db";

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
