import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { AuditAdminService } from "./audit.service";
import {
  assertActorlessRowSurvives,
  assertExportShape,
  assertFiltersNarrow,
  assertGlobalAdminOnly,
  assertOrderingIsStable,
  cleanup,
  loadFixtures,
  seedRows,
  type Fixtures,
} from "./audit.integration.spec";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../../testing/integration-db-gate";

/**
 * `F4.14` — Vitest entry point for the ADR 0021 audit read API. Assertions live
 * in the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 *
 * Skip/fail semantics match `F4.10` and `F2.1`: an unset `DATABASE_URL` skips
 * locally and throws under `CI`, while a *set* one is a claim that a database
 * exists, so a failed connection fails everywhere. This is the fourth copy of
 * the gate (`F4.10`, `F2.1`, `F2.2`, and now this one). `F2.1`'s file sets the
 * threshold at "once a third integration suite exists", which `F2.2` already
 * crossed — so the extraction is overdue, not newly due. Left in place
 * deliberately rather than refactoring three other suites inside the change
 * that introduces this feature; see the `F4.14` row.
 */

const connectionString = requireIntegrationDb({
  item: "F4.14",
  label: "audit read tests",
  because:
    "the global-admin gate, the actor left join and the (created_at, id) pagination " +
    "tie-break are database behaviours, so a green run without them asserts nothing.",
});

describe.skipIf(!connectionString)("F4.14 — audit read API", () => {
  let pool: pg.Pool | undefined;
  let svc: AuditAdminService;
  let fx: Fixtures;

  beforeAll(async () => {
        const created = await openIntegrationPool(connectionString as string, "F4.14");
    pool = created;

    const db = createDb(created);
    svc = new AuditAdminService(db, new AccessControlService(db));
    fx = await loadFixtures(created);
    // Before as well as after: a crashed previous run must not fail this one.
    await cleanup(created);
    await seedRows(created, fx);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await pool.end();
    }
  });

  it("admits only the unrestricted global admin (ADR 0021 decision 1)", async () => {
    await assertGlobalAdminOnly(svc, fx);
  });

  it("keeps rows whose actor could not be resolved", async () => {
    await assertActorlessRowSurvives(svc, fx);
  });

  it("orders newest first and pages stably across equal timestamps", async () => {
    await assertOrderingIsStable(svc, fx);
  });

  it("narrows on each filter without leaking non-matching rows", async () => {
    await assertFiltersNarrow(svc, fx);
  });

  it("exports CSV and XLSX under the same filters as the list", async () => {
    await assertExportShape(svc, fx);
  });
});
