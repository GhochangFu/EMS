import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type pg from "pg";
import * as XLSX from "xlsx";

import type { JwtPayload } from "@bms/shared";

import type { TelemetryImportService } from "./telemetry-import.service";

/** All rows this suite creates carry this asset code prefix. */
export const TEST_ASSET_PREFIX = "F19-IMPORT-TEST-";

export type Fixtures = {
  adminJwt: JwtPayload;
  /** wc-admin — location-scoped, used to prove the out-of-scope rejection. */
  scopedJwt: JwtPayload;
  /** No matching DB row and a non-master-data role — a true role-gate 403. */
  nonMasterDataJwt: JwtPayload;
  /** An asset outside scopedJwt's grant, and its code. */
  outOfScopeAssetId: string;
  outOfScopeAssetCode: string;
  /** A fresh, gateway-less test asset with no asset_points rows at all. */
  freshAssetId: string;
  freshAssetCode: string;
  freshAssetOrganizationId: string;
  /** One active point key in freshAssetId's organization, with its catalog unit. */
  freshAssetPointKey: { code: string; unit: string | null };
  /** More active point keys in the same organization, for multi-row files. */
  spareOrgPointKeys: { code: string; unit: string | null }[];
};

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Builds a workbook buffer from rows-of-cells, CSV or XLSX. */
function buildWorkbookBuffer(rows: (string | number)[][], bookType: "csv" | "xlsx" = "csv"): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Import");
  return XLSX.write(book, { type: "buffer", bookType }) as Buffer;
}

const HEADER = ["asset_code", "point_key", "value", "unit", "time"];

/**
 * Deletes only this suite's rows, children first. Safe to call when absent.
 * Mirrors `telemetry-write.spec.ts`'s `cleanup` — per-id deletes on
 * `telemetry.point_values`, never a subquery (ADR 0024's SEGMENTBY pruning
 * requirement).
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
      "telemetry-import fixtures missing — wc-admin@bms.local has no active location grant. " +
        "Run 'pnpm db:seed'.",
    );
  }

  const { rows: foreignRows } = await pool.query<{ id: string; code: string }>(
    `SELECT a.id, a.code FROM bms.assets a
       JOIN bms.locations l ON l.id = a.location_id
      WHERE l.organization_id <> $1 AND l.active = true
      ORDER BY a.code LIMIT 1`,
    [grant.organization_id],
  );
  if (!foreignRows[0]) {
    throw new Error("telemetry-import fixtures missing — no asset outside wc-admin's organization");
  }

  const { rows: keyRows } = await pool.query<{ code: string; unit: string | null }>(
    `SELECT code, unit FROM bms.point_keys
      WHERE organization_id = $1 AND active = true ORDER BY code LIMIT 5`,
    [grant.organization_id],
  );
  const freshAssetPointKey = keyRows[0];
  if (!freshAssetPointKey) {
    throw new Error("telemetry-import fixtures missing — wc-admin's organization has no active point key");
  }
  const spareOrgPointKeys = keyRows.slice(1);
  if (spareOrgPointKeys.length < 2) {
    throw new Error(
      "telemetry-import fixtures missing — wc-admin's organization needs at least 3 active point " +
        "keys (1 for freshAssetPointKey, 2 spare). Run 'pnpm db:seed'.",
    );
  }

  const freshCode = `${TEST_ASSET_PREFIX}${Date.now()}`;
  const { rows: assetRows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.assets (code, name, site_name, location_id, rtu_id, domain, active)
     VALUES ($1, 'F1.9 import-path fixture', 'Fixture Site', $2, NULL, 'water', true)
     RETURNING id`,
    [freshCode, grant.location_id],
  );
  const freshAssetId = assetRows[0]?.id;
  if (!freshAssetId) {
    throw new Error("telemetry-import fixtures — failed to insert the fresh test asset");
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
    // No user row matches this sub/email, so `AccessControlService` falls
    // back to the JWT's own claimed role — a clean role-gate 403 with no
    // dependency on a specific seeded non-master-data account existing.
    nonMasterDataJwt: {
      sub: "00000000-0000-4000-8000-0000000000ff",
      email: "f19-import-test-nobody@bms.local",
      name: "integration:viewer",
      role: "viewer",
    },
    outOfScopeAssetId: foreignRows[0].id,
    outOfScopeAssetCode: foreignRows[0].code,
    freshAssetId,
    freshAssetCode: freshCode,
    freshAssetOrganizationId: grant.organization_id,
    freshAssetPointKey,
    spareOrgPointKeys,
  };
}

async function fetchAssetPoint(
  pool: pg.Pool,
  assetId: string,
  pointKey: string,
): Promise<{ source_kind: string; rtu_id: string | null; unit: string | null } | null> {
  const { rows } = await pool.query(
    `SELECT source_kind, rtu_id, unit FROM bms.asset_points WHERE asset_id = $1 AND point_key = $2`,
    [assetId, pointKey],
  );
  return rows[0] ?? null;
}

async function fetchPointValue(
  pool: pg.Pool,
  assetId: string,
  pointKey: string,
  time: string,
): Promise<{ value: number } | null> {
  const { rows } = await pool.query(
    `SELECT value FROM telemetry.point_values WHERE asset_id = $1 AND point_key = $2 AND time = $3`,
    [assetId, pointKey, time],
  );
  return rows[0] ?? null;
}

async function countPointValuesForAsset(pool: pg.Pool, assetId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM telemetry.point_values WHERE asset_id = $1`,
    [assetId],
  );
  return Number(rows[0]?.count ?? "0");
}

/**
 * Drives `TelemetryImportService` and checks every outcome by **independent
 * SQL through the pool** — the same discipline `telemetry-write.spec.ts`
 * uses for the shared write path this composes.
 */
export async function runTelemetryImportServiceTests(
  pool: pg.Pool,
  svc: TelemetryImportService,
  fx: Fixtures,
): Promise<void> {
  const defaultOpts = { sourceKind: "unmapped" as const, conflictPolicy: "reject" as const };

  // ---- a non-master-data role is refused before any row is even parsed ------

  const viewerBuffer = buildWorkbookBuffer([HEADER, [fx.freshAssetCode, "kw", 1, "kW", new Date().toISOString()]]);
  let viewerRejected = false;
  try {
    await svc.preview(fx.nonMasterDataJwt, viewerBuffer, defaultOpts);
  } catch (err) {
    viewerRejected = err instanceof ForbiddenException;
  }
  assert(viewerRejected, "a non-master-data role must be refused (403) by preview() before parsing");

  let viewerCommitRejected = false;
  try {
    await svc.commit(fx.nonMasterDataJwt, viewerBuffer, defaultOpts);
  } catch (err) {
    viewerCommitRejected = err instanceof ForbiddenException;
  }
  assert(viewerCommitRejected, "a non-master-data role must be refused (403) by commit() before parsing");

  // ---- an out-of-scope asset_code and a nonexistent one are indistinguishable

  const outOfScopeTime = new Date().toISOString();
  const outOfScopeBuffer = buildWorkbookBuffer([
    HEADER,
    [fx.outOfScopeAssetCode, "kw", 1, "", outOfScopeTime],
  ]);
  const outOfScopeResult = await svc.commit(fx.scopedJwt, outOfScopeBuffer, defaultOpts);
  assert(outOfScopeResult.written === 0, "an out-of-scope asset_code must write nothing");
  assert(outOfScopeResult.rejected.length === 1, "the out-of-scope row must be reported as rejected");

  const nonexistentBuffer = buildWorkbookBuffer([
    HEADER,
    [`${TEST_ASSET_PREFIX}DOES-NOT-EXIST`, "kw", 1, "", new Date().toISOString()],
  ]);
  const nonexistentResult = await svc.commit(fx.scopedJwt, nonexistentBuffer, defaultOpts);
  assert(nonexistentResult.written === 0, "a nonexistent asset_code must write nothing");
  assert(
    nonexistentResult.rejected[0]?.reason === outOfScopeResult.rejected[0]?.reason,
    `an out-of-scope code and a nonexistent code must reject with the IDENTICAL message, got ` +
      `"${outOfScopeResult.rejected[0]?.reason}" vs "${nonexistentResult.rejected[0]?.reason}"`,
  );
  assert(
    (await fetchPointValue(pool, fx.outOfScopeAssetId, "kw", outOfScopeTime)) === null,
    "no point_values row may exist for the rejected out-of-scope write",
  );

  // ---- a malformed workbook is a 400, and writes nothing ---------------------

  const garbage = Buffer.from("not a spreadsheet \x00\x01", "utf8");
  let malformedRejected = false;
  const beforeCount = await countPointValuesForAsset(pool, fx.freshAssetId);
  try {
    await svc.commit(fx.adminJwt, garbage, defaultOpts);
  } catch (err) {
    malformedRejected = err instanceof BadRequestException;
  }
  assert(malformedRejected, "a malformed workbook must be a BadRequestException (400)");
  const afterCount = await countPointValuesForAsset(pool, fx.freshAssetId);
  assert(afterCount === beforeCount, "a malformed workbook must write nothing");

  // ---- an oversize file is refused -------------------------------------------

  const oversized = Buffer.concat([
    buildWorkbookBuffer([HEADER, [fx.freshAssetCode, "kw", 1, "", new Date().toISOString()]]),
    Buffer.alloc(6 * 1024 * 1024),
  ]);
  let oversizeRejected = false;
  try {
    await svc.commit(fx.adminJwt, oversized, defaultOpts);
  } catch (err) {
    oversizeRejected = err instanceof BadRequestException;
  }
  assert(oversizeRejected, "a file over the 5 MiB cap must be refused with a BadRequestException");

  // ---- a mixed file writes only the good rows, reports the bad with row #s --

  const [spareA, spareB] = fx.spareOrgPointKeys;
  const t1 = new Date().toISOString();
  const t2 = new Date(Date.now() + 1000).toISOString();
  const t3 = new Date(Date.now() + 2000).toISOString();
  const mixedRows: (string | number)[][] = [
    HEADER,
    [fx.freshAssetCode, fx.freshAssetPointKey.code, 10, fx.freshAssetPointKey.unit ?? "", t1], // row 2 — good
    [fx.freshAssetCode, "not-a-real-point-key-but-fine-shape", "not-a-number", "", t2], // row 3 — bad value
    [fx.freshAssetCode, spareA.code, 20, spareA.unit ?? "", t3], // row 4 — good
    [fx.freshAssetCode, spareB.code, 30, spareB.unit ?? "", "not-a-real-date"], // row 5 — bad time
  ];
  const mixedResult = await svc.commit(fx.adminJwt, buildWorkbookBuffer(mixedRows), defaultOpts);
  assert(mixedResult.written === 2, `expected 2 good rows written, got ${mixedResult.written}: ${JSON.stringify(mixedResult.rejected)}`);
  assert(mixedResult.rejected.length === 2, `expected 2 rejections, got ${JSON.stringify(mixedResult.rejected)}`);
  const rejectedRowNumbers = mixedResult.rejected.map((r) => r.rowNumber).sort();
  assert(
    rejectedRowNumbers[0] === 3 && rejectedRowNumbers[1] === 5,
    `rejections must carry the ORIGINAL file row numbers (3 and 5), got ${JSON.stringify(rejectedRowNumbers)}`,
  );
  assert(
    (await fetchPointValue(pool, fx.freshAssetId, fx.freshAssetPointKey.code, t1)) !== null,
    "the first good row must be written",
  );
  assert(
    (await fetchPointValue(pool, fx.freshAssetId, spareA.code, t3)) !== null,
    "the second good row must be written",
  );

  // ---- a created mapping carries source_kind='unmapped', rtu_id NULL --------
  // (default sourceKind — nothing supplied a gateway to attribute the row to)

  const createdMapping = await fetchAssetPoint(pool, fx.freshAssetId, fx.freshAssetPointKey.code);
  assert(createdMapping !== null, "the mapping row must exist after the import write");
  assert(
    createdMapping?.source_kind === "unmapped",
    `an import's default sourceKind must create a mapping with source_kind='unmapped', got '${createdMapping?.source_kind}'`,
  );
  assert(createdMapping?.rtu_id === null, "an import-created mapping must carry rtu_id=NULL");

  // ---- preview writes nothing, and its counts add up correctly --------------

  const previewOnlyTime = new Date().toISOString();
  const beforePreviewCount = await countPointValuesForAsset(pool, fx.freshAssetId);
  const previewRows: (string | number)[][] = [
    HEADER,
    [fx.freshAssetCode, spareB.code, 5, spareB.unit ?? "", previewOnlyTime],
    [fx.outOfScopeAssetCode, "kw", 1, "", new Date().toISOString()],
  ];
  // scopedJwt (wc-admin), not adminJwt: an unrestricted admin can manage
  // every asset, which would make `outOfScopeAssetCode` resolve as
  // "in scope" and defeat the point of this assertion.
  const previewResult = await svc.preview(fx.scopedJwt, buildWorkbookBuffer(previewRows), defaultOpts);
  assert(previewResult.totalRows === 2, `expected totalRows=2, got ${previewResult.totalRows}`);
  assert(previewResult.acceptedCount === 1, `expected acceptedCount=1, got ${previewResult.acceptedCount}`);
  assert(previewResult.rejectedCount === 1, `expected rejectedCount=1, got ${previewResult.rejectedCount}`);
  const afterPreviewCount = await countPointValuesForAsset(pool, fx.freshAssetId);
  assert(afterPreviewCount === beforePreviewCount, "preview must write nothing");
  assert(
    (await fetchPointValue(pool, fx.freshAssetId, spareB.code, previewOnlyTime)) === null,
    "preview must not write the row it counted as accepted",
  );

  // ---- the CHECK boundary rejects what the service must never be able to write
  // (direct SQL, bypassing the service entirely — proves the CONSTRAINT)

  let sourceRefRejected = false;
  try {
    await pool.query(
      `INSERT INTO bms.asset_points (asset_id, point_key, source_data_key, source_kind, rtu_id)
       VALUES ($1, 'f19-import-check-probe', 'f19-import-check-probe', 'measured', NULL)`,
      [fx.freshAssetId],
    );
  } catch (err) {
    sourceRefRejected =
      err instanceof Error && /asset_points_source_ref_check/.test(String((err as { message?: string }).message));
  }
  assert(sourceRefRejected, "asset_points_source_ref_check must reject source_kind='measured' with rtu_id NULL");

  let financeRejected = false;
  try {
    await pool.query(
      `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
       VALUES (now(), $1, 'f19-import-check-probe', 'NaN'::float8, NULL)`,
      [fx.freshAssetId],
    );
  } catch (err) {
    financeRejected =
      err instanceof Error && /point_values_value_finite_check/.test(String((err as { message?: string }).message));
  }
  assert(financeRejected, "point_values_value_finite_check must reject a NaN value");
}
