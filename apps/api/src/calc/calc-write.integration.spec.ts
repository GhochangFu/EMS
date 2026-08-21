import { and, eq } from "drizzle-orm";
import type pg from "pg";

import { assetPoints, assets, createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { MetricsService } from "../observability/metrics.service";
import { CalcWriteService } from "./calc-write.service";

/**
 * `F2.4` — `CalcWriteService` against a real database. Reuses `loadFixtures`
 * for org/location, and writes an `assets` row directly (no template
 * needed — this suite is about the value/mapping write path, not templates).
 */

const TEST_ASSET_PREFIX = "F24-CALCWRITE-TEST-";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export async function cleanup(pool: pg.Pool): Promise<void> {
  // ADR 0024 / tests/adr-0024-retention-bounds.test.ts: asset_id is a
  // SEGMENTBY column, so only a CONSTANT filter on it prunes compressed
  // batches — a DELETE reaching telemetry.point_values through a subquery
  // or join forces TimescaleDB to decompress every batch to evaluate the
  // predicate. Resolve the ids first, then filter on the resolved array
  // directly (`= ANY($1)`, no SELECT/JOIN/USING in the DELETE itself).
  const { rows: assetRows } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.assets WHERE code LIKE $1`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  const assetIds = assetRows.map((r) => r.id);
  if (assetIds.length > 0) {
    // No time bound: the constant asset_id filter alone is already
    // ADR 0024-compliant (SEGMENTBY, no subquery/join in the DELETE), and a
    // fixture-owned time window would eventually drift out of a rolling
    // "now() - interval" bound while the fixture's asset row still exists,
    // orphaning the point_values row permanently once the parent is deleted.
    await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])`, [assetIds]);
  }
  await pool.query(
    `DELETE FROM bms.asset_points WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
}

async function seedAsset(db: BmsDb, fx: Fixtures, suffix: string): Promise<string> {
  const [asset] = await db
    .insert(assets)
    .values({
      code: `${TEST_ASSET_PREFIX}${suffix}`,
      name: "Calc Write Fixture Asset",
      siteName: "Fixture Site",
      locationId: fx.otherLocationId,
      domain: "electrical",
    })
    .returning({ id: assets.id });
  return asset.id;
}

/** Scoped to one asset's `entity_id`, not a bare table count — this suite
 * shares a database with every other integration suite, which write their
 * own audit_log rows concurrently, so an unscoped count is racy under
 * parallel test execution. */
async function countAuditLogForAsset(pool: pg.Pool, assetId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM bms.audit_log WHERE entity_id = $1`,
    [assetId],
  );
  return Number(rows[0].n);
}

export async function assertFirstValueCreatesMappingWithComputedProvenance(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const assetId = await seedAsset(db, fx, "01");
  const svc = new CalcWriteService(db, pool, new MetricsService());

  const result = await svc.writeValues([{ assetId, pointKey: "CALCWRITE_A", value: 42, time: new Date() }]);
  assert(result.written === 1, `expected 1 value written, got ${result.written}`);
  assert(result.assetPointsCreated === 1, `expected 1 asset_points row created, got ${result.assetPointsCreated}`);

  const [mapping] = await db
    .select()
    .from(assetPoints)
    .where(and(eq(assetPoints.assetId, assetId), eq(assetPoints.pointKey, "CALCWRITE_A")));
  assert(mapping !== undefined, "the mapping row must exist");
  assert(mapping.sourceKind === "computed", `expected sourceKind "computed", got "${mapping.sourceKind}"`);
  assert(mapping.rtuId === null, "a computed mapping must carry rtuId: null");
  assert(
    mapping.sourceDataKey === "computed:CALCWRITE_A",
    `expected sourceDataKey "computed:CALCWRITE_A", got "${mapping.sourceDataKey}"`,
  );
}

export async function assertSecondValueDoesNotCreateASecondMapping(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const assetId = await seedAsset(db, fx, "02");
  const svc = new CalcWriteService(db, pool, new MetricsService());

  const first = await svc.writeValues([{ assetId, pointKey: "CALCWRITE_B", value: 1, time: new Date() }]);
  assert(first.assetPointsCreated === 1, "the first value must create the mapping");

  const second = await svc.writeValues([
    { assetId, pointKey: "CALCWRITE_B", value: 2, time: new Date(Date.now() + 60_000) },
  ]);
  assert(
    second.assetPointsCreated === 0,
    `a second value for an already-mapped point must not create a second mapping, got ${second.assetPointsCreated}`,
  );

  const rows = await db
    .select()
    .from(assetPoints)
    .where(and(eq(assetPoints.assetId, assetId), eq(assetPoints.pointKey, "CALCWRITE_B")));
  assert(rows.length === 1, `expected exactly 1 mapping row, got ${rows.length}`);
}

export async function assertRewritingTheSameInstantIsANoOp(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const db = createDb(pool);
  const assetId = await seedAsset(db, fx, "03");
  const svc = new CalcWriteService(db, pool, new MetricsService());
  const time = new Date("2026-08-20T12:00:00.000Z");

  const first = await svc.writeValues([{ assetId, pointKey: "CALCWRITE_C", value: 5, time }]);
  assert(first.written === 1, `expected the first write to land 1 row, got ${first.written}`);

  const second = await svc.writeValues([{ assetId, pointKey: "CALCWRITE_C", value: 999, time }]);
  assert(
    second.written === 0,
    `a recompute at the same (time, assetId, pointKey) must be a no-op, reported 0 written — got ${second.written}`,
  );

  const { rows } = await pool.query<{ n: string; value: string }>(
    `SELECT COUNT(*)::text AS n, MIN(value)::text AS value FROM telemetry.point_values
      WHERE asset_id = $1 AND point_key = $2`,
    [assetId, "CALCWRITE_C"],
  );
  assert(rows[0].n === "1", `expected exactly 1 stored row, got ${rows[0].n}`);
  assert(
    Number(rows[0].value) === 5,
    `the original value (5) must survive — onConflictDoNothing must never overwrite, got ${rows[0].value}`,
  );
}

export async function assertOverlongPointKeySkipsOnlyThatPairNotTheBatch(
  pool: pg.Pool,
  fx: Fixtures,
): Promise<void> {
  const db = createDb(pool);
  const assetId = await seedAsset(db, fx, "05");
  const svc = new CalcWriteService(db, pool, new MetricsService());

  // "computed:" is 9 chars; asset_points.source_data_key is varchar(128), so
  // any pointKey over 119 chars overflows it even though pointKey alone is
  // valid up to 128 chars everywhere it is checked (pointKeyCode).
  const overlongPointKey = "X".repeat(120);
  const time = new Date();

  const result = await svc.writeValues([
    { assetId, pointKey: overlongPointKey, value: 1, time },
    { assetId, pointKey: "CALCWRITE_E_OK", value: 2, time },
  ]);

  assert(
    result.written === 1,
    `the overlong pointKey must be skipped and the other pair must still write — expected 1 written, got ${result.written}`,
  );
  assert(
    result.assetPointsCreated === 1,
    `only the valid pair's mapping must be created — expected 1, got ${result.assetPointsCreated}`,
  );

  const overlongRows = await db
    .select()
    .from(assetPoints)
    .where(and(eq(assetPoints.assetId, assetId), eq(assetPoints.pointKey, overlongPointKey)));
  assert(overlongRows.length === 0, "the overlong pointKey must never get a mapping row");

  const okRows = await db
    .select()
    .from(assetPoints)
    .where(and(eq(assetPoints.assetId, assetId), eq(assetPoints.pointKey, "CALCWRITE_E_OK")));
  assert(okRows.length === 1, "the valid pair's mapping must exist despite the other pair in the same batch failing");
}

export async function assertNoAuditLogRowIsProduced(pool: pg.Pool, fx: Fixtures): Promise<void> {
  const db = createDb(pool);
  const assetId = await seedAsset(db, fx, "04");
  const svc = new CalcWriteService(db, pool, new MetricsService());

  const before = await countAuditLogForAsset(pool, assetId);
  await svc.writeValues([
    { assetId, pointKey: "CALCWRITE_D1", value: 1, time: new Date() },
    { assetId, pointKey: "CALCWRITE_D2", value: 2, time: new Date() },
  ]);
  const after = await countAuditLogForAsset(pool, assetId);
  assert(
    after === before,
    `a calc write must never produce an audit_log row (decision 10) — before ${before}, after ${after}`,
  );
}
