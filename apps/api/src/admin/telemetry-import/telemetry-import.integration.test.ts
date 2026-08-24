import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { MasterDataAuditService } from "../master-data-audit.service";
import { TelemetryWriteService } from "../telemetry-entry/telemetry-write.service";
import { cleanup, loadFixtures, runTelemetryImportServiceTests, type Fixtures } from "./telemetry-import.spec";
import { TelemetryImportService } from "./telemetry-import.service";

/**
 * `F1.9` — Vitest entry point for the CSV/Excel bulk import path.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the
 * database lifecycle.
 *
 * Cleans up before AND after: a crashed run must not poison the next one on
 * a shared local database.
 */
const connectionString = requireIntegrationDb({
  item: "F1.9",
  label: "telemetry bulk-import tests",
  because:
    "asset-code resolution's non-disclosure property, the shared write path's " +
    "scope check, and the source_kind CHECK boundary are all database " +
    "behaviours. A green run without them proves nothing about the one " +
    "outcome this feature must never produce: an existence oracle, or a " +
    "silently wrong or lost reading.",
});

describe.skipIf(!connectionString)("TelemetryImportService", () => {
  let pool: pg.Pool | undefined;
  let svc: TelemetryImportService;
  let fx: Fixtures;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F1.9");
    pool = created;
    await cleanup(created);

    const db = createDb(created);
    const access = new AccessControlService(db, db, db);
    const audit = new MasterDataAuditService(db);
    const writeService = new TelemetryWriteService(db, db, created, access, audit);
    svc = new TelemetryImportService(db, access, writeService);
    fx = await loadFixtures(created);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await pool.end();
    }
  }, 60_000);

  it(
    "resolves asset codes without disclosing scope, writes only good rows, and never re-implements the write path",
    async () => {
      if (!pool) throw new Error("pool not initialised");
      await runTelemetryImportServiceTests(pool, svc, fx);
    },
    30_000,
  );
});
