import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { MasterDataAuditService } from "../master-data-audit.service";
import { ManualReadingsController } from "./manual-readings.controller";
import { cleanup, loadFixtures, runManualReadingsControllerTests, type Fixtures } from "./manual-readings.spec";
import { TelemetryWriteService } from "./telemetry-write.service";

/**
 * `F1.8` — Vitest entry point for `ManualReadingsController`'s own contract.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the
 * database lifecycle. Reuses `telemetry-write.spec.ts`'s fixture logic under
 * its own asset-code prefix, so this suite's rows never collide with that
 * suite's when both `*.integration.test.ts` files run concurrently.
 */
const connectionString = requireIntegrationDb({
  item: "F1.8",
  label: "manual telemetry entry endpoint tests",
  because:
    "role enforcement (403 vs 200-with-rejection), response-shape validation, and " +
    "error mapping are database/HTTP-layer behaviours this controller owns; the " +
    "write-path semantics themselves are already proven by telemetry-write.spec.ts.",
});

describe.skipIf(!connectionString)("ManualReadingsController", () => {
  let pool: pg.Pool | undefined;
  let controller: ManualReadingsController;
  let fx: Fixtures;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F1.8");
    pool = created;
    await cleanup(created);

    const db = createDb(created);
    const access = new AccessControlService(db, db, db);
    const audit = new MasterDataAuditService(db);
    const svc = new TelemetryWriteService(db, db, created, access, audit);
    controller = new ManualReadingsController(svc);
    fx = await loadFixtures(created);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await pool.end();
    }
  }, 60_000);

  it(
    "enforces the master-data role, shapes its response, and maps ZodError to 400",
    async () => {
      if (!pool) throw new Error("pool not initialised");
      await runManualReadingsControllerTests(pool, controller, fx);
    },
    30_000,
  );
});
