import type pg from "pg";

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
  /**
   * At least two more active point keys in the same organization, distinct
   * from `freshAssetPointKey` and from each other — tests that need a
   * still-unmapped point (SAVEPOINT isolation, dedup) must not collide with
   * whichever earlier test already mapped `freshAssetPointKey`.
   */
  spareOrgPointKeys: { code: string; unit: string | null }[];
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
export async function cleanup(pool: pg.Pool, prefix: string = TEST_ASSET_PREFIX): Promise<void> {
  const { rows: testAssets } = await pool.query<{ id: string }>(
    `SELECT id FROM bms.assets WHERE code LIKE $1`,
    [`${prefix}%`],
  );
  for (const { id } of testAssets) {
    await pool.query(`DELETE FROM telemetry.point_values WHERE asset_id = $1::uuid`, [id]);
  }

  await pool.query(
    `DELETE FROM bms.asset_points
      WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${prefix}%`],
  );
  await pool.query(
    `DELETE FROM bms.audit_log
      WHERE entity_type = 'asset'
        AND entity_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
    [`${prefix}%`],
  );
  await pool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${prefix}%`]);
}

/**
 * `prefix` lets a sibling suite (e.g. `manual-readings.spec.ts`) reuse this
 * fixture logic under its own asset-code prefix, so the two integration
 * suites' fixture rows can never collide when Vitest runs their files
 * concurrently — a shared prefix would let one suite's `cleanup()` delete
 * the other's fresh asset mid-run.
 */
export async function loadFixtures(pool: pg.Pool, prefix: string = TEST_ASSET_PREFIX): Promise<Fixtures> {
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
       -- \`F3.39\`: the catalog is fleet-wide, so the join is on code alone.
       JOIN bms.point_keys pk
         ON pk.code = ap.point_key
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
    // `F3.39`: fleet-wide catalog, so no organization predicate. The
    // `created_at` ordering is F4.53's "oldest wins" and matters more now that
    // other suites register transient codes in the same shared table.
    //
    // **`unit IS NOT NULL` is not tidying.** The unit-mismatch case below writes
    // a deliberately wrong unit and asserts the row is rejected; a catalog key
    // with a NULL unit has nothing to mismatch against, so the case passes
    // vacuously — or rather, it fails, which is how this was found. The
    // organization predicate used to make it unreachable: `wc-admin`'s catalog
    // came from `UNIT_BY_KEY`, where an unset unit is `""` and not NULL.
    // Fleet-wide, the oldest rows are `phe-pilot-seed`'s, and some of those
    // carry a genuine NULL.
    //
    // **NULL and `""` are different here, and only NULL is the problem.**
    // `telemetry-write.service.ts` guards the comparison on
    // `authoritativeUnit !== null`, so an empty-string unit is still compared
    // and a wrong unit is still rejected. That is why this predicate stops at
    // NULL and does not also exclude `""` — a code whose unit is `""` gates
    // exactly as well as one whose unit is `kW`.
    //
    // **`F3.41` moved `chlorine_pump_on` out of the NULL set**, so this comment
    // no longer names it. It joined `METERED_PUMPING_POINT_KEYS`, which gave it
    // a `UNIT_BY_KEY` entry of `""` — the binary spelling `pf` and
    // `breaker_main` already use. `network_strength` and
    // `controller_power_status` are still NULL: they are `environment` domain
    // and stayed out of that array deliberately.
    `SELECT code, unit FROM bms.point_keys
      WHERE active = true AND unit IS NOT NULL ORDER BY created_at, code LIMIT 5`,
  );
  const freshAssetPointKey = keyRows[0];
  if (!freshAssetPointKey) {
    throw new Error("telemetry-write fixtures missing — wc-admin's organization has no active point key");
  }
  const spareOrgPointKeys = keyRows.slice(1);
  if (spareOrgPointKeys.length < 3) {
    throw new Error(
      "telemetry-write fixtures missing — wc-admin's organization needs at least 4 active point " +
        "keys (1 for freshAssetPointKey, 3 spare). Run 'pnpm db:seed'.",
    );
  }

  const freshCode = `${prefix}${Date.now()}`;
  // E7.1b: stamp organization_id, exactly as `AssetsAdminService.create` does
  // since 0046 — a fixture that inserts an asset directly must carry the org, or
  // an auto-provisioned mapping derived from it inherits a NULL org.
  const { rows: assetRows } = await pool.query<{ id: string }>(
    `INSERT INTO bms.assets (code, name, site_name, location_id, rtu_id, domain, active, organization_id)
     VALUES ($1, 'F1.8/F1.9 write-path fixture', 'Fixture Site', $2, NULL, 'water', true, $3)
     RETURNING id`,
    [freshCode, grant.location_id, grant.organization_id],
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
    spareOrgPointKeys,
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
  organization_id: string | null;
} | null> {
  const { rows } = await pool.query(
    `SELECT source_kind, rtu_id, unit, active, organization_id FROM bms.asset_points
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
  // E7.1b: the auto-provisioned mapping carries the asset's org. Nullable with
  // no default, so this is NULL — and the assertion fails — without the stamping.
  assert(
    createdMapping?.organization_id === fx.freshAssetOrganizationId,
    `an auto-provisioned mapping must be stamped with the asset's org ` +
      `(${fx.freshAssetOrganizationId}), got ${createdMapping?.organization_id}`,
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
  // This row lands on a real seeded asset outside TEST_ASSET_PREFIX, so
  // `cleanup()` cannot reach it — delete it here, by the constant asset_id
  // the ADR 0024 guard requires, so a local run leaves no stray reading.
  await pool.query(
    `DELETE FROM telemetry.point_values WHERE asset_id = $1 AND point_key = $2 AND time = $3`,
    [fx.existingMeasured.assetId, fx.existingMeasured.pointKey, throughMeasuredTime],
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

  // ---- a source_data_key collision isolates only the rows that need it -----
  // Since E7.1b the mapping creation runs on `fleetDb` before the value
  // transaction, each pair its own independent statement — so a 23505
  // source_data_key collision on one pair rejects only the rows that needed it,
  // without touching the others or the later value writes. (Before E7.1b this
  // rested on a nested `tx.transaction()` SAVEPOINT; the guarantee is the same,
  // the mechanism is now statement independence rather than sub-transaction
  // rollback.) This test catches a regression that would let one collision lose
  // the whole batch.

  const [victimKey, plantedKey, safeKey] = fx.spareOrgPointKeys;
  await pool.query(
    `INSERT INTO bms.asset_points (asset_id, point_key, source_data_key, source_kind, rtu_id, unit, active, organization_id)
     VALUES ($1, $2, $3, 'manual', NULL, $4, true, $5)`,
    [fx.freshAssetId, plantedKey.code, `manual:${victimKey.code}`, plantedKey.unit, fx.freshAssetOrganizationId],
  );
  const victimTime = new Date().toISOString();
  const safeTime = new Date().toISOString();
  const savepointResult = await svc.writeReadings(fx.adminJwt, {
    rows: [
      row({ assetId: fx.freshAssetId, pointKey: victimKey.code, time: victimTime, unit: victimKey.unit ?? undefined }),
      row({ assetId: fx.freshAssetId, pointKey: safeKey.code, time: safeTime, unit: safeKey.unit ?? undefined }),
    ],
    sourceKind: "manual",
    conflictPolicy: "reject",
    auditAction: "telemetry.manual_entry",
  });
  assert(
    savepointResult.result.written + savepointResult.result.skipped === 2,
    `written + skipped must equal the input row count, got written=${savepointResult.result.written} ` +
      `skipped=${savepointResult.result.skipped}`,
  );
  assert(
    savepointResult.result.written === 1,
    `only the non-colliding row must be written, wrote ${savepointResult.result.written}: ` +
      JSON.stringify(savepointResult.rejected),
  );
  assert(
    savepointResult.rejected.length === 1 && savepointResult.rejected[0]?.rowNumber === 1,
    `row 1 (the colliding mapping) must be the only rejection, got ${JSON.stringify(savepointResult.rejected)}`,
  );
  assert(
    (await fetchAssetPoint(pool, fx.freshAssetId, victimKey.code)) === null,
    "no mapping may be created for the row whose source_data_key collided",
  );
  assert(
    (await fetchPointValue(pool, fx.freshAssetId, victimKey.code, victimTime)) === null,
    "no value may be written for the row whose mapping creation failed",
  );
  assert(
    (await fetchAssetPoint(pool, fx.freshAssetId, safeKey.code)) !== null,
    "the non-colliding row's mapping must still be created despite the other row's collision",
  );
  assert(
    (await fetchPointValue(pool, fx.freshAssetId, safeKey.code, safeTime)) !== null,
    "the non-colliding row's value must still be written despite the other row's collision",
  );

  // ---- an in-batch duplicate is rejected, not a crash ------------------------

  const dupSourceTime = new Date().toISOString();
  const dupResult = await svc.writeReadings(fx.adminJwt, {
    rows: [
      row({ assetId: fx.freshAssetId, pointKey: fx.freshAssetPointKey.code, time: dupSourceTime }),
      row({ assetId: fx.freshAssetId, pointKey: fx.freshAssetPointKey.code, time: dupSourceTime }),
    ],
    sourceKind: "manual",
    conflictPolicy: "reject",
    auditAction: "telemetry.manual_entry",
  });
  assert(
    dupResult.result.written + dupResult.result.skipped === 2,
    `written + skipped must equal the input row count, got written=${dupResult.result.written} ` +
      `skipped=${dupResult.result.skipped}`,
  );
  assert(dupResult.result.written === 1, `exactly one of the two duplicate rows must be written, wrote ${dupResult.result.written}`);
  assert(
    dupResult.rejected.length === 1 && /duplicate of row 1/i.test(dupResult.rejected[0]?.reason ?? ""),
    `the second duplicate row must be rejected and name row 1, got ${JSON.stringify(dupResult.rejected)}`,
  );

  // ---- caller-supplied rowNumbers are used verbatim, in the reason text too -
  // The importer's `rows` array is NOT in original-sheet order once
  // out-of-scope/nonexistent asset codes have been filtered out by
  // `resolveRows` — a 1-based index into `rows` names the wrong sheet row,
  // both as the rejection's own `rowNumber` field and inside a duplicate
  // rejection's `reason` text. `rowNumbers` lets a caller report both in ITS
  // OWN numbering.

  const callerNumberedTime = new Date().toISOString();
  const callerNumberedResult = await svc.writeReadings(fx.adminJwt, {
    rows: [
      row({ assetId: fx.freshAssetId, pointKey: fx.freshAssetPointKey.code, time: callerNumberedTime }),
      row({ assetId: fx.freshAssetId, pointKey: fx.freshAssetPointKey.code, time: callerNumberedTime }),
    ],
    rowNumbers: [42, 43],
    sourceKind: "manual",
    conflictPolicy: "reject",
    auditAction: "telemetry.manual_entry",
  });
  assert(
    callerNumberedResult.rejected.length === 1 && callerNumberedResult.rejected[0]?.rowNumber === 43,
    `the duplicate's own rowNumber must be the caller-supplied 43, got ${JSON.stringify(callerNumberedResult.rejected)}`,
  );
  assert(
    /duplicate of row 42/i.test(callerNumberedResult.rejected[0]?.reason ?? ""),
    `the reason text must name the caller-supplied first-seen row 42, not a 1-based array index, got ` +
      `"${callerNumberedResult.rejected[0]?.reason}"`,
  );

  // ---- a reject-policy conflict is a visible rejection, not a silent skip ---

  const conflictTime = new Date().toISOString();
  const firstWrite = await svc.writeReadings(fx.adminJwt, {
    rows: [row({ assetId: fx.freshAssetId, pointKey: fx.freshAssetPointKey.code, time: conflictTime })],
    sourceKind: "manual",
    conflictPolicy: "reject",
    auditAction: "telemetry.manual_entry",
  });
  assert(firstWrite.result.written === 1, "the first write to a fresh (time, assetId, pointKey) must succeed");

  const secondWrite = await svc.writeReadings(fx.adminJwt, {
    rows: [row({ assetId: fx.freshAssetId, pointKey: fx.freshAssetPointKey.code, time: conflictTime, value: 99 })],
    sourceKind: "manual",
    conflictPolicy: "reject",
    auditAction: "telemetry.manual_entry",
  });
  assert(secondWrite.result.written === 0, "a reject-policy conflict must write nothing");
  assert(
    secondWrite.rejected.length === 1 && /already exists/i.test(secondWrite.rejected[0]?.reason ?? ""),
    `a reject-policy conflict must appear as a named rejection, not only a count, got ` +
      `${JSON.stringify(secondWrite.rejected)}`,
  );
  // An attempt where every row was rejected must still leave an audit trail
  // — driven by what was ATTEMPTED, not only by what landed.
  const { rows: allRejectedAuditRows } = await pool.query<{ row_count: number }>(
    `SELECT (payload->>'rowCount')::int AS row_count FROM bms.audit_log
      WHERE entity_type = 'asset' AND entity_id = $1
        AND payload->>'batchId' = $2`,
    [fx.freshAssetId, secondWrite.result.batchId],
  );
  assert(
    allRejectedAuditRows.length === 1 && allRejectedAuditRows[0]?.row_count === 0,
    `an all-rejected batch must still write one audit row with rowCount 0, got ` +
      `${JSON.stringify(allRejectedAuditRows)}`,
  );
  const unchangedValue = await fetchPointValue(pool, fx.freshAssetId, fx.freshAssetPointKey.code, conflictTime);
  assert(
    unchangedValue?.value === 42,
    `the original value must be unchanged by the rejected conflicting write, got ${unchangedValue?.value}`,
  );

  // ---- a non-finite value and an unparsable time are both rejected ----------

  const validationResult = await svc.writeReadings(fx.adminJwt, {
    rows: [
      { assetId: fx.freshAssetId, pointKey: fx.freshAssetPointKey.code, value: Number.NaN, time: new Date().toISOString() },
      { assetId: fx.freshAssetId, pointKey: fx.freshAssetPointKey.code, value: 1, time: "not-a-real-date" },
    ],
    sourceKind: "manual",
    conflictPolicy: "reject",
    auditAction: "telemetry.manual_entry",
  });
  assert(validationResult.result.written === 0, "neither an unfinite value nor an unparsable time may be written");
  assert(
    validationResult.rejected.length === 2,
    `both rows must be rejected, got ${JSON.stringify(validationResult.rejected)}`,
  );
  // Every row here failed validation BEFORE the transaction opens — there is
  // no `accepted` row to key an audit entry on, and the early return must
  // still leave a trail: an attempt that touches the DB not at all is
  // exactly the case with the least evidence otherwise.
  const { rows: preTxAuditRows } = await pool.query<{ row_count: number; rejected_row_numbers: number[] }>(
    `SELECT (payload->>'rowCount')::int AS row_count, payload->'rejectedRowNumbers' AS rejected_row_numbers
       FROM bms.audit_log
      WHERE entity_id = $1`,
    [validationResult.result.batchId],
  );
  assert(
    preTxAuditRows.length === 1 && preTxAuditRows[0]?.row_count === 0,
    `a batch rejected entirely before the transaction must still write one audit row with rowCount 0, got ` +
      `${JSON.stringify(preTxAuditRows)}`,
  );
  assert(
    Array.isArray(preTxAuditRows[0]?.rejected_row_numbers) && preTxAuditRows[0]?.rejected_row_numbers.length === 2,
    `the audit payload must name the rejected rows, got ${JSON.stringify(preTxAuditRows[0]?.rejected_row_numbers)}`,
  );

  // ---- the post-commit aggregate refresh actually runs ----------------------
  // A row older than `_1m`'s 3h start_offset sits outside ADR 0023's
  // real-time branch — it appears in `point_values_1m` only if a refresh
  // actually recomputed that bucket. Proves `refreshAggregatesFrom` ran
  // rather than merely typechecking.

  const oldEnoughTime = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const { rows: beforeBucket } = await pool.query(
    `SELECT 1 FROM telemetry.point_values_1m
      WHERE asset_id = $1 AND point_key = $2 AND bucket = time_bucket('1 minute', $3::timestamptz)`,
    [fx.freshAssetId, fx.freshAssetPointKey.code, oldEnoughTime],
  );
  assert(beforeBucket.length === 0, "the 1m bucket for this not-yet-written reading must not already exist");

  const refreshResult = await svc.writeReadings(fx.adminJwt, {
    rows: [row({ assetId: fx.freshAssetId, pointKey: fx.freshAssetPointKey.code, time: oldEnoughTime, value: 7 })],
    sourceKind: "manual",
    conflictPolicy: "reject",
    auditAction: "telemetry.manual_entry",
  });
  assert(refreshResult.result.written === 1, "the outside-real-time-window reading must be written");
  const { rows: afterBucket } = await pool.query(
    `SELECT 1 FROM telemetry.point_values_1m
      WHERE asset_id = $1 AND point_key = $2 AND bucket = time_bucket('1 minute', $3::timestamptz)`,
    [fx.freshAssetId, fx.freshAssetPointKey.code, oldEnoughTime],
  );
  assert(
    afterBucket.length === 1,
    "the 1m bucket must exist after the write — the post-commit refresh must have run synchronously",
  );

  // ---- an audit row exists with the expected action and a uuid entity_id ----

  const { rows: auditRows } = await pool.query<{ action: string; entity_id: string; point_keys: string[] }>(
    `SELECT action, entity_id, payload->'pointKeys' AS point_keys FROM bms.audit_log
      WHERE entity_type = 'asset' AND entity_id = $1 AND action = 'telemetry.manual_entry'
      ORDER BY created_at DESC LIMIT 1`,
    [fx.freshAssetId],
  );
  assert(auditRows.length === 1, "an audit row must exist for the fresh asset's write");
  assert(
    /^[0-9a-f-]{36}$/i.test(auditRows[0].entity_id),
    `entity_id must be a uuid, got "${auditRows[0].entity_id}"`,
  );
  // The audit trail must name which point(s) were written, not just the
  // asset and a row count — otherwise an overwrite is traceable to "this
  // asset, this time window" but not reconstructable to "this point".
  assert(
    Array.isArray(auditRows[0].point_keys) && auditRows[0].point_keys.includes(fx.freshAssetPointKey.code),
    `the audit payload must name the written point key, got ${JSON.stringify(auditRows[0].point_keys)}`,
  );
}
