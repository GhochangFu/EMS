import { BadRequestException, NotFoundException } from "@nestjs/common";
import { eq, is, sql, TransactionRollbackError } from "drizzle-orm";

import {
  alarmAffectedAssets,
  alarmEnrichments,
  alarmSkills,
  alarms,
  assets,
  automationRules,
  locations,
  pointValues,
  users,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AlarmDetailsService } from "./alarm-details.service";
import { AlarmEnrichmentService } from "./alarm-enrichment.service";
import { VocabulariesService } from "../vocabularies/vocabularies.service";

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

async function organizationIdForAsset(db: BmsDb, assetId: string): Promise<string> {
  const [row] = await db
    .select({ organizationId: locations.organizationId })
    .from(assets)
    .innerJoin(locations, eq(assets.locationId, locations.id))
    .where(eq(assets.id, assetId))
    .limit(1);
  if (!row) {
    throw new Error(`no location/organization found for asset ${assetId}`);
  }
  return row.organizationId;
}

async function firstSeededUser(db: BmsDb): Promise<Pick<JwtPayload, "sub" | "email">> {
  const [user] = await db.select({ id: users.id, email: users.email }).from(users).limit(1);
  if (!user) {
    throw new Error("no seeded user available — run pnpm db:seed first");
  }
  return { sub: user.id, email: user.email };
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

/** A third seeded asset, distinct from both given ids. */
async function thirdSeededAssetId(db: BmsDb, excludeIds: [string, string]): Promise<string> {
  const [asset] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(sql`${assets.id} NOT IN (${excludeIds[0]}, ${excludeIds[1]})`)
    .limit(1);
  if (!asset) {
    throw new Error("need at least three seeded assets — run pnpm db:seed first");
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

/**
 * `GET .../details` returns the alarm's own asset's `organizationId` — the
 * affected-asset picker (ADR 0034 decision 4) needs this to narrow its
 * candidate list; review found the picker mixing assets across
 * organizations before this field existed.
 */
export async function assertDetailsReturnsOrganizationId(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const expectedOrgId = await organizationIdForAsset(tx, assetId);
    const alarmId = await insertTestAlarm(tx, assetId, "E21_TEST_DETAILS_ORG");

    const details = await new AlarmDetailsService(tx).get(alarmId, null);
    assert(
      details.organizationId === expectedOrgId,
      `expected organizationId ${expectedOrgId}, got ${details.organizationId}`,
    );

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

// ---------------------------------------------------------------------------
// PUT /api/v1/alarms/:id/enrichment (ADR 0034 decision 6)
// ---------------------------------------------------------------------------

/** A first upsert creates the row; a second overwrites it — one row, not two. */
export async function assertEnrichmentUpsertCreatesThenUpdates(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const alarmId = await insertTestAlarm(tx, assetId, "E21_TEST_UPSERT_CREATE_UPDATE");
    const actor = await firstSeededUser(tx);
    const svc = new AlarmEnrichmentService(tx, new VocabulariesService(tx));

    await svc.upsert(alarmId, actor, { rootCause: "first" }, null);
    await svc.upsert(alarmId, actor, { rootCause: "second" }, null);

    const rows = await tx
      .select({ id: alarmEnrichments.id, rootCause: alarmEnrichments.rootCause })
      .from(alarmEnrichments)
      .where(eq(alarmEnrichments.alarmId, alarmId));
    assert(rows.length === 1, `expected exactly one enrichment row after two upserts, got ${rows.length}`);
    assert(
      rows[0]?.rootCause === "second",
      `expected the second write to overwrite the first, got ${rows[0]?.rootCause}`,
    );

    tx.rollback();
  });
}

/** `created_at` survives an update; `updated_at`/`updated_by` are (re)written. */
export async function assertEnrichmentUpsertTimestampsBehaveOnUpdate(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const alarmId = await insertTestAlarm(tx, assetId, "E21_TEST_UPSERT_TIMESTAMPS");
    const actor = await firstSeededUser(tx);
    const svc = new AlarmEnrichmentService(tx, new VocabulariesService(tx));

    await svc.upsert(alarmId, actor, { rootCause: "v1" }, null);
    const [before] = await tx
      .select({ createdAt: alarmEnrichments.createdAt, updatedAt: alarmEnrichments.updatedAt })
      .from(alarmEnrichments)
      .where(eq(alarmEnrichments.alarmId, alarmId));
    if (!before) {
      throw new Error("missing enrichment after the first upsert");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
    await svc.upsert(alarmId, actor, { rootCause: "v2" }, null);
    const [after] = await tx
      .select({
        createdAt: alarmEnrichments.createdAt,
        updatedAt: alarmEnrichments.updatedAt,
        updatedBy: alarmEnrichments.updatedBy,
      })
      .from(alarmEnrichments)
      .where(eq(alarmEnrichments.alarmId, alarmId));
    if (!after) {
      throw new Error("missing enrichment after the second upsert");
    }

    assert(
      after.createdAt.getTime() === before.createdAt.getTime(),
      "created_at must not change on an update",
    );
    assert(after.updatedAt.getTime() > before.updatedAt.getTime(), "updated_at must advance on an update");
    assert(after.updatedBy === actor.sub, "updated_by must record the actor");

    tx.rollback();
  });
}

/** An unknown skillCode is a 400 from `assertAlarmSkill`, not a 500 from the foreign key. */
export async function assertEnrichmentUpsertRejectsUnknownSkill(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const alarmId = await insertTestAlarm(tx, assetId, "E21_TEST_UPSERT_BAD_SKILL");
    const actor = await firstSeededUser(tx);
    const svc = new AlarmEnrichmentService(tx, new VocabulariesService(tx));

    let rejected = false;
    try {
      await svc.upsert(alarmId, actor, { skillCode: "e21_test_not_a_real_skill" }, null);
    } catch (err) {
      rejected = err instanceof BadRequestException;
    }
    assert(rejected, "an unknown skillCode must raise BadRequestException, not a raw FK violation");

    tx.rollback();
  });
}

/**
 * An `affectedAssetIds` entry outside the caller's scope is rejected, and
 * nothing is written — the finding beyond ADR 0034: scoping the alarm does
 * not scope the caller-supplied affected-asset ids on its own.
 */
export async function assertEnrichmentUpsertRejectsOutOfScopeAffectedAsset(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const outOfScopeAsset = await secondSeededAssetId(tx, assetId);
    const alarmId = await insertTestAlarm(tx, assetId, "E21_TEST_UPSERT_SCOPE_AFFECTED");
    const actor = await firstSeededUser(tx);
    const svc = new AlarmEnrichmentService(tx, new VocabulariesService(tx));

    let rejected = false;
    try {
      await svc.upsert(alarmId, actor, { affectedAssetIds: [outOfScopeAsset] }, [assetId]);
    } catch (err) {
      rejected = err instanceof BadRequestException;
    }
    assert(rejected, "an affectedAssetIds entry outside the caller's scope must be rejected");

    const rows = await tx
      .select({ id: alarmEnrichments.id })
      .from(alarmEnrichments)
      .where(eq(alarmEnrichments.alarmId, alarmId));
    assert(rows.length === 0, "nothing should be written when an affected asset is out of scope");

    tx.rollback();
  });
}

/** `affectedAssetIds` is a set: replacing it drops the ids no longer listed. */
export async function assertEnrichmentUpsertReplacesAffectedAssetSet(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const otherAsset = await secondSeededAssetId(tx, assetId);
    const alarmId = await insertTestAlarm(tx, assetId, "E21_TEST_UPSERT_REPLACE_AFFECTED");
    const actor = await firstSeededUser(tx);
    const svc = new AlarmEnrichmentService(tx, new VocabulariesService(tx));

    await svc.upsert(alarmId, actor, { affectedAssetIds: [assetId, otherAsset] }, null);
    await svc.upsert(alarmId, actor, { affectedAssetIds: [assetId] }, null);

    const [enrichment] = await tx
      .select({ id: alarmEnrichments.id })
      .from(alarmEnrichments)
      .where(eq(alarmEnrichments.alarmId, alarmId));
    if (!enrichment) {
      throw new Error("missing enrichment");
    }
    const rows = await tx
      .select({ assetId: alarmAffectedAssets.assetId })
      .from(alarmAffectedAssets)
      .where(eq(alarmAffectedAssets.enrichmentId, enrichment.id));
    assert(
      rows.length === 1 && rows[0]?.assetId === assetId,
      `expected only [assetId] to remain, got ${rows.map((r) => r.assetId).join(", ")}`,
    );

    tx.rollback();
  });
}

/** An alarm outside the caller's scope raises not-found, matching `AlarmDetailsService.get`. */
export async function assertEnrichmentUpsertScopedByAssetIds(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const otherAssetId = await secondSeededAssetId(tx, assetId);
    const alarmId = await insertTestAlarm(tx, assetId, "E21_TEST_UPSERT_SCOPE_ALARM");
    const actor = await firstSeededUser(tx);
    const svc = new AlarmEnrichmentService(tx, new VocabulariesService(tx));

    let notFound = false;
    try {
      await svc.upsert(alarmId, actor, { rootCause: "x" }, [otherAssetId]);
    } catch (err) {
      notFound = err instanceof NotFoundException;
    }
    assert(notFound, "an alarm outside the caller's assetIds must raise NotFoundException");

    tx.rollback();
  });
}

/**
 * Security finding: replacing `affectedAssetIds` must not delete a row for an
 * asset outside the caller's scope. The insert direction was already scoped
 * (`assertEnrichmentUpsertRejectsOutOfScopeAffectedAsset`); this is the delete
 * direction, which a full unscoped `DELETE ... WHERE enrichment_id = ?` would
 * silently destroy on the next scoped replace.
 */
export async function assertEnrichmentUpsertDeleteScopedToCallerAccess(db: BmsDb): Promise<void> {
  await withRollback(db, async (tx) => {
    const assetId = await firstSeededAssetId(tx);
    const inScopeAffected = await secondSeededAssetId(tx, assetId);
    const outOfScopeAffected = await thirdSeededAssetId(tx, [assetId, inScopeAffected]);
    const alarmId = await insertTestAlarm(tx, assetId, "E21_TEST_UPSERT_DELETE_SCOPE");
    const actor = await firstSeededUser(tx);
    const callerScope = [assetId, inScopeAffected];
    const svc = new AlarmEnrichmentService(tx, new VocabulariesService(tx));

    // Seed both an in-scope and an out-of-scope affected asset directly —
    // bypassing the service's own insert-side scope check, the way a prior
    // admin write (assetIds === null) legitimately could.
    const [enrichment] = await tx
      .insert(alarmEnrichments)
      .values({ alarmId })
      .returning({ id: alarmEnrichments.id });
    if (!enrichment) {
      throw new Error("failed to insert test enrichment");
    }
    await tx.insert(alarmAffectedAssets).values([
      { enrichmentId: enrichment.id, assetId: inScopeAffected },
      { enrichmentId: enrichment.id, assetId: outOfScopeAffected },
    ]);

    // The scoped caller replaces the set with an empty list — clearing only
    // what they can see.
    await svc.upsert(alarmId, actor, { affectedAssetIds: [] }, callerScope);

    const remaining = await tx
      .select({ assetId: alarmAffectedAssets.assetId })
      .from(alarmAffectedAssets)
      .where(eq(alarmAffectedAssets.enrichmentId, enrichment.id));
    assert(
      remaining.length === 1 && remaining[0]?.assetId === outOfScopeAffected,
      `a scoped replace must not delete an affected-asset row outside the caller's scope; ` +
        `expected [${outOfScopeAffected}] to survive, got [${remaining.map((r) => r.assetId).join(", ")}]`,
    );

    tx.rollback();
  });
}
