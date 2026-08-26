import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { MasterDataAuditService } from "../master-data-audit.service";
import { cleanup, loadFixtures, runTelemetryWriteServiceTests, type Fixtures } from "./telemetry-write.spec";
import { TelemetryWriteService } from "./telemetry-write.service";

/**
 * `F1.8`/`F1.9` Phase A — Vitest entry point for the shared write path.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the
 * database lifecycle.
 *
 * Cleans up before AND after: a crashed run must not poison the next one on
 * a shared local database.
 */
const connectionString = requireIntegrationDb({
  item: "F1.8/F1.9",
  label: "telemetry write-path tests",
  because:
    "access scoping, the source_kind CHECK boundary, mapping creation-on-demand " +
    "vs preserving an existing mapping, unit resolution, and the retention " +
    "horizon are all database behaviours. A green run without them proves " +
    "nothing about the one outcome this pair must never produce: a silently " +
    "wrong or lost reading.",
});

describe.skipIf(!connectionString)("TelemetryWriteService", () => {
  let pool: pg.Pool | undefined;
  let svc: TelemetryWriteService;
  let fx: Fixtures;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F1.8/F1.9");
    pool = created;
    await cleanup(created);

    const db = createDb(created);
    const access = new AccessControlService(db, db);
    const audit = new MasterDataAuditService(db, db);
    svc = new TelemetryWriteService(db, db, created, access, audit);
    fx = await loadFixtures(created);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await pool.end();
    }
  }, 60_000);

  it(
    "scopes writes, resolves mappings, enforces units and retention, and audits",
    async () => {
      if (!pool) throw new Error("pool not initialised");
      await runTelemetryWriteServiceTests(pool, svc, fx);
    },
    // ~10 write batches, several driving 4 refresh_continuous_aggregate
    // calls each — comfortably under a second uncontended, but the vitest
    // default (5s) has been observed to breach under a full-suite run
    // sharing the database with other integration suites.
    30_000,
  );

  it("the CHECK boundary rejects what the service must never be able to write", async () => {
    if (!pool) throw new Error("pool not initialised");
    // Direct SQL, bypassing the service entirely — this proves the CONSTRAINT,
    // not the Zod enum or the service's own logic.
    let sourceRefRejected = false;
    try {
      await pool.query(
        // E7.1b: stamp organization_id so 0047's NOT NULL does not fire before
        // the CHECK this probe exists to prove (the fleet pool bypasses the
        // tenant policy, so only the NOT NULL would pre-empt it).
        `INSERT INTO bms.asset_points (asset_id, organization_id, point_key, source_data_key, source_kind, rtu_id)
         VALUES ($1, $2, 'f18-check-probe', 'f18-check-probe', 'measured', NULL)`,
        [fx.freshAssetId, fx.freshAssetOrganizationId],
      );
    } catch (err) {
      sourceRefRejected =
        err instanceof Error && /asset_points_source_ref_check/.test(String((err as { message?: string }).message));
    }
    if (!sourceRefRejected) {
      throw new Error("asset_points_source_ref_check must reject source_kind='measured' with rtu_id NULL");
    }

    let financeRejected = false;
    try {
      await pool.query(
        `INSERT INTO telemetry.point_values (time, asset_id, point_key, value, unit)
         VALUES (now(), $1, 'f18-check-probe', 'NaN'::float8, NULL)`,
        [fx.freshAssetId],
      );
    } catch (err) {
      financeRejected =
        err instanceof Error &&
        /point_values_value_finite_check/.test(String((err as { message?: string }).message));
    }
    if (!financeRejected) {
      throw new Error("point_values_value_finite_check must reject a NaN value");
    }
  });
});
