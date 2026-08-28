import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { AuditAdminService } from "./audit.service";
import {
  assertActorlessRowSurvives,
  assertExportShape,
  assertFiltersNarrow,
  assertGrantlessOrgAdminReadsNothing,
  assertMultiOrganizationScope,
  assertOrderingIsStable,
  assertOrganizationScope,
  assertReadGateRoles,
  assertScopedExport,
  cleanup,
  cleanupGrantlessOrgAdmin,
  loadFixtures,
  seedGrantlessOrgAdmin,
  seedOrganizationRows,
  seedRows,
  type Fixtures,
} from "./audit.integration.spec";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../../testing/integration-db-gate";

/**
 * `F4.14` — Vitest entry point for the ADR 0021 audit read API, widened by
 * `E7.1e` / ADR 0046. Assertions live in the sibling `.spec` (ADR 0014); this
 * file owns the database lifecycle.
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
    "the read gate, the ADR 0046 organization scope (including that a tenant never sees a " +
    "NULL-organization row), the actor left join and the (created_at, id) pagination " +
    "tie-break are database behaviours, so a green run without them asserts nothing.",
});

// `E7.1e`: the grantless `organization_admin` is a `bms.users` row, and only
// the provisioning superuser can write one under FORCE — `bms_fleet` has
// BYPASSRLS but no INSERT/DELETE on that table (ADR 0043 Amendment 4), which
// this suite proved the hard way with `permission denied for table users`. The
// gate's `connection: "superuser"` is the ONE sanctioned path to that
// connection; ADR 0045's `adr-0045-owner-and-superuser-url` invariant forbids
// naming the env var anywhere else. Setup and teardown alone use it — every
// assertion still runs through `AuditAdminService` on the fleet pool.
const superuserConnectionString = requireIntegrationDb({
  item: "E7.1e",
  label: "the grantless organization_admin fixture",
  because:
    "an organization_admin with an empty scope is the §4.7 case the reader must not confuse " +
    "with the global admin's null, and without the row that branch is never executed.",
  connection: "superuser",
});

describe.skipIf(!connectionString)("F4.14 — audit read API", () => {
  let pool: pg.Pool | undefined;
  let superuserPool: pg.Pool | undefined;
  let svc: AuditAdminService;
  let fx: Fixtures;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F4.14");
    pool = created;
    const createdSuperuser = await openIntegrationPool(
      superuserConnectionString as string,
      "E7.1e",
    );
    superuserPool = createdSuperuser;

    const db = createDb(created);
    svc = new AuditAdminService(db, new AccessControlService(db, db));
    fx = await loadFixtures(created);
    // Before as well as after: a crashed previous run must not fail this one.
    await cleanup(created);
    await cleanupGrantlessOrgAdmin(createdSuperuser);
    await seedRows(created, fx);
    await seedOrganizationRows(created, fx);
    await seedGrantlessOrgAdmin(createdSuperuser, fx);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await pool.end();
    }
    if (superuserPool) {
      await cleanupGrantlessOrgAdmin(superuserPool);
      await superuserPool.end();
    }
  });

  it("admits admin and organization_admin, and refuses the rest (ADR 0046 decisions 3–4)", async () => {
    await assertReadGateRoles(svc, fx);
  });

  it("scopes an organization admin to its own rows, never NULL (ADR 0046 decisions 1–2)", async () => {
    await assertOrganizationScope(svc, fx);
  });

  it("reads every granted organization for a multi-organization actor", async () => {
    await assertMultiOrganizationScope(svc, fx);
  });

  it("reads nothing for an organization admin with no grant (§4.7)", async () => {
    await assertGrantlessOrgAdminReadsNothing(svc, fx);
  });

  it("exports under the same scope as the list (ADR 0046 decision 6)", async () => {
    await assertScopedExport(svc, fx);
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
