import type pg from "pg";

import { telemetryWriteResponseSchema } from "@bms/shared";

import type { ManualReadingsController } from "./manual-readings.controller";
import { cleanup, loadFixtures, TEST_ASSET_PREFIX, type Fixtures } from "./telemetry-write.spec";

export { cleanup, loadFixtures, TEST_ASSET_PREFIX };
export type { Fixtures };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Behavioural cover for `ManualReadingsController` — the controller's OWN
 * contract only (role enforcement wiring, response shape, error mapping).
 * Phase A's mapping/unit/retention/dedup/CHECK-boundary behaviour is already
 * proven against `TelemetryWriteService` directly by
 * `telemetry-write.spec.ts` and is deliberately not re-proven here.
 */
export async function runManualReadingsControllerTests(
  pool: pg.Pool,
  controller: ManualReadingsController,
  fx: Fixtures,
): Promise<void> {
  // ---- a non-master-data caller is refused (403), nothing written -----------

  const hvacAdminJwt = {
    sub: "00000000-0000-4000-8000-000000000000",
    email: "wc-hvac-admin@bms.local",
    name: "integration:asset-group-admin",
    role: "asset_group_admin" as const,
  };
  const forbiddenTime = new Date().toISOString();
  let forbiddenRejected = false;
  try {
    await controller.create(
      { rows: [{ assetId: fx.freshAssetId, pointKey: fx.freshAssetPointKey.code, value: 1, time: forbiddenTime }], conflictPolicy: "reject" },
      hvacAdminJwt,
    );
  } catch (err) {
    forbiddenRejected = err instanceof Object && "status" in err && (err as { status: number }).status === 403;
  }
  assert(forbiddenRejected, "a non-master-data caller must receive a 403");
  const { rows: forbiddenRows } = await pool.query(
    `SELECT 1 FROM telemetry.point_values WHERE asset_id = $1 AND time = $2`,
    [fx.freshAssetId, forbiddenTime],
  );
  assert(forbiddenRows.length === 0, "a 403'd request must write nothing, verified by SQL");

  // ---- an out-of-scope asset is a 200 with a rejected row, not a 403 --------

  const outOfScopeResult = await controller.create(
    {
      rows: [{ assetId: fx.outOfScopeAssetId, pointKey: "kw", value: 1, time: new Date().toISOString() }],
      conflictPolicy: "reject",
    },
    fx.scopedJwt,
  );
  assert(outOfScopeResult.result.written === 0, "an out-of-scope asset must write nothing");
  assert(outOfScopeResult.rejected.length === 1, "an out-of-scope asset must appear as a rejected row, not throw");

  // ---- happy path: source_kind, auditAction, and the response shape ---------

  const happyTime = new Date().toISOString();
  const happyResult = await controller.create(
    {
      rows: [
        {
          assetId: fx.freshAssetId,
          pointKey: fx.freshAssetPointKey.code,
          value: 12.5,
          time: happyTime,
          unit: fx.freshAssetPointKey.unit ?? undefined,
        },
      ],
      conflictPolicy: "reject",
    },
    fx.adminJwt,
  );
  assert(happyResult.result.written === 1, `expected 1 row written: ${JSON.stringify(happyResult.rejected)}`);

  const { rows: mappingRows } = await pool.query<{ source_kind: string }>(
    `SELECT source_kind FROM bms.asset_points WHERE asset_id = $1 AND point_key = $2`,
    [fx.freshAssetId, fx.freshAssetPointKey.code],
  );
  assert(
    mappingRows[0]?.source_kind === "manual",
    `the created mapping must carry source_kind='manual' regardless of body, got '${mappingRows[0]?.source_kind}' — ` +
      "the request body cannot set sourceKind (proven by the request schema's own .strict())",
  );

  const { rows: auditRows } = await pool.query<{ action: string }>(
    `SELECT action FROM bms.audit_log
      WHERE entity_type = 'asset' AND entity_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [fx.freshAssetId],
  );
  assert(
    auditRows[0]?.action === "telemetry.manual_entry",
    `auditAction must be 'telemetry.manual_entry', got '${auditRows[0]?.action}'`,
  );

  const parsedResponse = telemetryWriteResponseSchema.safeParse(happyResult);
  assert(
    parsedResponse.success,
    `the controller's response must satisfy telemetryWriteResponseSchema: ${JSON.stringify(parsedResponse)}`,
  );

  // ---- conflictPolicy default (reject) vs explicit overwrite -----------------

  const conflictTime = new Date().toISOString();
  const firstOfConflict = await controller.create(
    { rows: [{ assetId: fx.freshAssetId, pointKey: fx.freshAssetPointKey.code, value: 1, time: conflictTime }] },
    fx.adminJwt,
  );
  assert(firstOfConflict.result.written === 1, "the first write of a fresh (time, assetId, pointKey) must succeed");

  const rejectedSecond = await controller.create(
    {
      rows: [{ assetId: fx.freshAssetId, pointKey: fx.freshAssetPointKey.code, value: 2, time: conflictTime }],
      conflictPolicy: "reject",
    },
    fx.adminJwt,
  );
  assert(rejectedSecond.result.written === 0, "conflictPolicy must default to 'reject' when omitted");

  const overwrittenSecond = await controller.create(
    {
      rows: [{ assetId: fx.freshAssetId, pointKey: fx.freshAssetPointKey.code, value: 3, time: conflictTime }],
      conflictPolicy: "overwrite",
    },
    fx.adminJwt,
  );
  assert(overwrittenSecond.result.written === 1, "an explicit conflictPolicy: 'overwrite' must overwrite");
  const { rows: overwrittenValue } = await pool.query<{ value: string }>(
    `SELECT value FROM telemetry.point_values WHERE asset_id = $1 AND point_key = $2 AND time = $3`,
    [fx.freshAssetId, fx.freshAssetPointKey.code, conflictTime],
  );
  assert(
    Number(overwrittenValue[0]?.value) === 3,
    `the overwritten value must be 3, got ${overwrittenValue[0]?.value}`,
  );

  // ---- a malformed body raises BadRequestException, not a raw 500 ----------

  let badRequestRaised = false;
  try {
    await controller.create({ rows: [] }, fx.adminJwt);
  } catch (err) {
    badRequestRaised = err instanceof Object && "status" in err && (err as { status: number }).status === 400;
  }
  assert(badRequestRaised, "an empty rows array must raise a 400 BadRequestException, not a raw 500");
}
