import type pg from "pg";

import type { BmsDb } from "@bms/db";
import type { JwtPayload, TelemetryEntryRow } from "@bms/shared";

import type { TelemetryWriteService } from "./telemetry-write.service";

/** All rows this suite creates carry this asset code prefix. */
export const TEST_ASSET_PREFIX = "F18-WRITE-TEST-";

export type Fixtures = {
  adminJwt: JwtPayload;
  /** wc-admin — location-scoped, used to prove the out-of-scope rejection. */
  scopedJwt: JwtPayload;
  /** An asset outside scopedJwt's grant. */
  outOfScopeAssetId: string;
  /**
   * An existing `measured` asset_points row (rtu-backed), whose point key is
   * also active in its own organization's catalog — so a write through it is
   * a realistic, not merely permitted, case.
   */
  existingMeasured: {
    assetId: string;
    pointKey: string;
    rtuId: string;
    unit: string | null;
  };
  /** A fresh, gateway-less test asset with no asset_points rows at all. */
  freshAssetId: string;
  freshAssetOrganizationId: string;
  /** One active point key in freshAssetId's organization, with its catalog unit. */
  freshAssetPointKey: { code: string; unit: string | null };
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Deletes only this suite's rows, children first. Safe to call when absent.
 *
 * `telemetry.point_values` is deleted **per resolved id**, never through a
 * subquery or join — `tests/adr-0024-retention-bounds.test.ts` (ADR 0024)
 * requires exactly this shape and rejects a subquery one, the same shape
 * `apps/api/src/telemetry/rollup-conversion.integration.spec.ts` already
 * moved to for the identical reason: `asset_id` is a SEGMENTBY column
 * (migration 0028), and only a CONSTANT equality on it lets TimescaleDB prune
 * compressed batches. A subquery forces decompression of the whole compressed
 * history to evaluate the predicate — measured failing outright with `tuple
 * decompression limit exceeded by operation` on this seeded database.
 */
export async function cleanup(pool: pg.Pool): Promise<void> {
  const { rows: testAssets } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.assets WHERE code LIKE $1`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  for (const { id } of testAssets) {
    await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = $1::uuid`, [id]);
  }

  await pool.query(
    `DELETE FROM bms.asset_points
      WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(
    `DELETE FROM bms.audit_log
      WHERE entity_type = 'asset'
        AND entity_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${TEST_ASSET_PREFIX}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${TEST_ASSET_PREFIX}%`]);
}

export async function loadFixtures(pool: pg.Pool): Promise<Fixtures> {
  const { rows: grants } = await pool.query<{ organization_id: string; location_id: string }>(
    `SELECT l.organization_id, l.id AS location_id
       FROM bms.users u
       JOIN bms.user_location_access ula ON ula.user_id = u.id
       JOIN bms.locations l ON l.id = ula.location_id
      WHERE u.email = 'wc-admin@bms.local' AND l.active = true
      LIMIT 1`,
  );
  const grant = grants[0];
  if (!grant) {
    throw new Error(
      "telemetry-write fixtures missing — wc-admin@bms.local has no active location grant. " +
        "Run 'pnpm db:seed'.",
    );
  }

  const { rows: foreignRows } = await pool.query<{ id: string }>(
    `SELECT a.id FROM bms.assets a
       JOIN bms.locations l ON l.id = a.location_id
      WHERE l.organization_id <> $1 AND l.active = true
      ORDER BY a.code LIMIT 1`,
    [grant.organization_id],
  );
  if (!foreignRows[0]) {
    throw new Error("telemetry-write fixtures missing — no asset outside wc-admin's organization");
  }

  const { rows: measuredRows } = await pool.query<{
    asset_id: string;
    point_key: string;
    rtu_id: string;
    unit: string | null;
  }>(
    `SELECT ap.asset_id, ap.point_key, ap.rtu_id, ap.unit
       FROM bms.asset_points ap
       JOIN bms.assets a ON a.id = ap.asset_id
       JOIN bms.locations l ON l.id = a.location_id
       JOIN bms.point_keys pk
         ON pk.organization_id = l.organization_id
        AND pk.code = ap.point_key
        AND pk.active = true
      WHERE ap.source_kind = 'measured' AND ap.active = true
      LIMIT 1`,
  );
  const existing = measuredRows[0];
  if (!existing) {
    throw new Error(
      "telemetry-write fixtures missing — no active 'measured' asset_points row whose point " +
        "key is also active in its organization's catalog. Run 'pnpm db:seed'.",
    );
  }

  const { rows: keyRows } = await pool.query<{ code: string; unit: string | null }>(
    `SELECT code, unit FROM bms.point_keys
      WHERE organization_id = $1 AND active = true ORDER BY code LIMIT 1`,
    [grant.organization_id],
  );
  const freshAssetPointKey = keyRows[0];
  if (!freshAssetPointKey) {
    throw new Error("telemetry-write fixtures missing — wc-admin's organization has no active point key");
  }

  const freshCode = `${TEST_ASSET_PREFIX}${Date.now()}`;
  const { rows: assetRows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.assets (code, name, site_name, location_id, rtu_id, domain, active)
     VALUES ($1, 'F1.8/F1.9 write-path fixture', 'Fixture Site', $2, NULL, 'water', true)
     RETURNING id`,
    [freshCode, grant.location_id],
  );
  const freshAssetId = assetRows[0]?.id;
  if (!freshAssetId) {
    throw new Error("telemetry-write fixtures — failed to insert the fresh test asset");
  }

  return {
    adminJwt: {
      sub: "00000000-0000-4000-8000-000000000000",
      email: "admin@bms.local",
      name: "integration:admin",
      role: "admin",
    },
    scopedJwt: {
      sub: "00000000-0000-4000-8000-000000000000",
      email: "wc-admin@bms.local",
      name: "integration:location-admin",
      role: "location_admin",
    },
    outOfScopeAssetId: foreignRows[0].id,
    existingMeasured: {
      assetId: existing.asset_id,
      pointKey: existing.point_key,
      rtuId: existing.rtu_id,
      unit: existing.unit,
    },
    freshAssetId,
    freshAssetOrganizationId: grant.organization_id,
    freshAssetPointKey,
  };
}

function row(overrides: Partial<TelemetryEntryRow> & { assetId: string; pointKey: string }): TelemetryEntryRow {
  return {
    value: 42,
    time: new Date().toISOString(),
    ...overrides,
  };
}

async function fetchAssetPoint(
  pool: pg.Pool,
  assetId: string,
  pointKey: string,
): Promise<{
  source_kind: string;
  rtu_id: string | null;
  unit: string | null;
  active: boolean;
} | null> {
  const { rows } = await pool.query(
    `SELECT source_kind, rtu_id, unit, active FROM bms.asset_points
      WHERE asset_id = $1 AND point_key = $2`,
    [assetId, pointKey],
  );
  return rows[0] ?? null;
}

async function fetchPointValue(
  pool: pg.Pool,
  assetId: string,
  pointKey: string,
  time: string,
): Promise<{ value: number; unit: string | null } | null> {
  const { rows } = await pool.query(
    `SELECT value, unit FROM telemetry.point_values
      WHERE asset_id = $1 AND point_key = $2 AND time = $3`,
    [assetId, pointKey, time],
  );
  return rows[0] ?? null;
}

/**
 * Drives `TelemetryWriteService` and checks every outcome by **independent
 * SQL through the pool** — never by reading back the service's own return
 * value, which would let it grade its own work.
 */
export async function runTelemetryWriteServiceTests(
  pool: pg.Pool,
  svc: TelemetryWriteService,
  fx: Fixtures,
): Promise<void> {
  // ---- out-of-scope asset is refused, nothing written -----------------------

  const outOfScopeTime = new Date().toISOString();
  const scopedResult = await svc.writeReadings(fx.scopedJwt, {
    rows: [row({ assetId: fx.outOfScopeAssetId, pointKey: "kw", time: outOfScopeTime })],
    sourceKind: "manual",
    conflictPolicy: "reject",
    auditAction: "telemetry.manual_entry",
  });
  assert(
    scopedResult.result.written === 0,
    `an out-of-scope asset must write nothing, wrote ${scopedResult.result.written}`,
  );
  assert(scopedResult.rejected.length === 1, "the out-of-scope row must be reported as rejected");
  assert(
    (await fetchPointValue(pool, fx.outOfScopeAssetId, "kw", outOfScopeTime)) === null,
    "no point_values row may exist for a rejected out-of-scope write",
  );

  // ---- unknown assetId is refused -------------------------------------------

  const unknownAssetId = "00000000-0000-4000-8000-000000000099";
  const unknownResult = await svc.writeReadings(fx.adminJwt, {
    rows: [row({ assetId: unknownAssetId, pointKey: "kw" })],
    sourceKind: "manual",
    conflictPolicy: "reject",
    auditAction: "telemetry.manual_entry",
  });
  assert(unknownResult.result.written === 0, "a nonexistent asset must write nothing");
  assert(unknownResult.rejected.length === 1, "a nonexistent asset must be reported as rejected");

  // ---- new mapping is created with source_kind='manual', rtu_id null --------

  const freshTime = new Date().toISOString();
  const freshResult = await svc.writeReadings(fx.adminJwt, {
    rows: [
      row({
        assetId: fx.freshAssetId,
        pointKey: fx.freshAssetPointKey.code,
        time: freshTime,
        unit: fx.freshAssetPointKey.unit ?? undefined,
      }),
    ],
    sourceKind: "manual",
    conflictPolicy: "reject",
    auditAction: "telemetry.manual_entry",
  });
  assert(
    freshResult.result.written === 1,
    `expected 1 row written for the fresh asset, got ${freshResult.result.written}: ` +
      JSON.stringify(freshResult.rejected),
  );
  assert(freshResult.result.assetPointsCreated === 1, "a new asset_points mapping must be created");
  const createdMapping = await fetchAssetPoint(pool, fx.freshAssetId, fx.freshAssetPointKey.code);
  assert(createdMapping !== null, "the mapping row must exist after the write");
  assert(
    createdMapping?.source_kind === "manual",
    `created mapping must carry source_kind='manual', got '${createdMapping?.source_kind}'`,
  );
  assert(
    createdMapping?.rtu_id === null,
    "created mapping must carry rtu_id=NULL — nobody claimed a gateway",
  );
  const writtenValue = await fetchPointValue(pool, fx.freshAssetId, fx.freshAssetPointKey.code, freshTime);
  assert(writtenValue !== null, "the reading must exist in telemetry.point_values");
  assert(
    writtenValue?.unit === fx.freshAssetPointKey.unit,
    `stored unit must be the catalog unit (${fx.freshAssetPointKey.unit}), got ${writtenValue?.unit}`,
  );

  // ---- an existing 'measured' mapping is byte-for-byte unchanged ------------

  const beforeMapping = await fetchAssetPoint(
    pool,
    fx.existingMeasured.assetId,
    fx.existingMeasured.pointKey,
  );
  const throughMeasuredTime = new Date().toISOString();
  const measuredResult = await svc.writeReadings(fx.adminJwt, {
    rows: [
      row({
        assetId: fx.existingMeasured.assetId,
        pointKey: fx.existingMeasured.pointKey,
        time: throughMeasuredTime,
        unit: fx.existingMeasured.unit ?? undefined,
      }),
    ],
    sourceKind: "manual",
    conflictPolicy: "reject",
    auditAction: "telemetry.manual_entry",
  });
  assert(
    measuredResult.result.written === 1,
    `a write through an existing measured point must succeed: ${JSON.stringify(measuredResult.rejected)}`,
  );
  assert(
    measuredResult.result.assetPointsCreated === 0,
    "writing through an EXISTING mapping must not create a new one",
  );
  const afterMapping = await fetchAssetPoint(
    pool,
    fx.existingMeasured.assetId,
    fx.existingMeasured.pointKey,
  );
  assert(
    JSON.stringify(beforeMapping) === JSON.stringify(afterMapping),
    `an existing measured mapping must be byte-for-byte unchanged: before=${JSON.stringify(
      beforeMapping,
    )} after=${JSON.stringify(afterMapping)}`,
  );

  // ---- a unit mismatch rejects the row, nothing written ----------------------

  const mismatchTime = new Date().toISOString();
  const mismatchResult = await svc.writeReadings(fx.adminJwt, {
    rows: [
      row({
        assetId: fx.freshAssetId,
        pointKey: fx.freshAssetPointKey.code,
        time: mismatchTime,
        unit: "definitely-the-wrong-unit",
      }),
    ],
    sourceKind: "manual",
    conflictPolicy: "reject",
    auditAction: "telemetry.manual_entry",
  });
  assert(mismatchResult.result.written === 0, "a unit mismatch must write nothing");
  assert(mismatchResult.rejected.length === 1, "a unit mismatch must be reported as rejected");
  assert(
    (await fetchPointValue(pool, fx.freshAssetId, fx.freshAssetPointKey.code, mismatchTime)) === null,
    "no point_values row may exist for a rejected unit mismatch",
  );

  // ---- a row older than RAW_RETENTION_DAYS is rejected, nothing written -----

  const ancientTime = new Date(Date.now() - 800 * 24 * 60 * 60 * 1000).toISOString();
  const ancientResult = await svc.writeReadings(fx.adminJwt, {
    rows: [
      row({
        assetId: fx.freshAssetId,
        pointKey: fx.freshAssetPointKey.code,
        time: ancientTime,
        unit: fx.freshAssetPointKey.unit ?? undefined,
      }),
    ],
    sourceKind: "manual",
    conflictPolicy: "reject",
    auditAction: "telemetry.manual_entry",
  });
  assert(ancientResult.result.written === 0, "a reading past raw retention must write nothing");
  assert(ancientResult.rejected.length === 1, "a reading past raw retention must be reported as rejected");
  assert(
    /retention|730|days/i.test(ancientResult.rejected[0]?.reason ?? ""),
    `the rejection reason should name the retention horizon, got: ${ancientResult.rejected[0]?.reason}`,
  );

  // ---- an audit row exists with the expected action and a uuid entity_id ----

  const { rows: auditRows } = await pool.query<{ action: string; entity_id: string }>(
    `SELECT action, entity_id FROM bms.audit_log
      WHERE entity_type = 'asset' AND entity_id = $1 AND action = 'telemetry.manual_entry'
      ORDER BY created_at DESC LIMIT 1`,
    [fx.freshAssetId],
  );
  assert(auditRows.length === 1, "an audit row must exist for the fresh asset's write");
  assert(
    /^[0-9a-f-]{36}$/i.test(auditRows[0].entity_id),
    `entity_id must be a uuid, got "${auditRows[0].entity_id}"`,
  );
}
