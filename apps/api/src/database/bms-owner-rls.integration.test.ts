import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertATenantContextRevealsExactlyThatOrganisation,
  assertForceIsSetOnEveryTenantTable,
  assertTheOwnerCannotWriteWithoutATenantContext,
  assertTheOwnerIsNotPrivilegedOutOfItsOwnPolicies,
  assertTheOwnerSeesNothingWithoutATenantContext,
} from "./bms-owner-rls.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `E7.1a` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 *
 * `connection: "owner"` is the entire point: this is the only suite in the
 * repository that connects as `bms_owner` and means to be *bound* by the
 * policies. Every other integration suite reaches the database on `bms_fleet`
 * (BYPASSRLS), `bms_tenant`, or the provisioning superuser.
 *
 * Run it locally (docker-compose.override.yml may remap the published port):
 *
 *   DATABASE_URL=postgres://bms_owner:bms_owner_dev@localhost:5432/bms \
 *     pnpm --filter api test bms-owner-rls
 */
const connectionString = requireIntegrationDb({
  item: "E7.1a",
  label: "owner-side row-level-security tests",
  because:
    "they are the only check that FORCE ROW LEVEL SECURITY actually binds the schema " +
    "owner. Every other integration suite connects on BYPASSRLS, a tenant role or the " +
    "superuser, so a dropped FORCE, a BYPASSRLS granted to bms_owner, or a new tenant " +
    "table shipped without a policy would leave the whole suite green.",
  connection: "owner",
});

describe.skipIf(!connectionString)("E7.1a — FORCE ROW LEVEL SECURITY binds bms_owner", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "E7.1a");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("connects as bms_owner, which is neither a superuser nor BYPASSRLS", async () => {
    await assertTheOwnerIsNotPrivilegedOutOfItsOwnPolicies(pool as pg.Pool);
  });

  it("has ENABLE and FORCE row level security on all five tenant tables", async () => {
    await assertForceIsSetOnEveryTenantTable(pool as pg.Pool);
  });

  it("returns no rows to the owner when no tenant context is set", async () => {
    await assertTheOwnerSeesNothingWithoutATenantContext(pool as pg.Pool);
  });

  it("refuses a write from the owner when no tenant context is set", async () => {
    await assertTheOwnerCannotWriteWithoutATenantContext(pool as pg.Pool);
  });

  // Without this the checks above would also pass on a connection that is simply
  // broken — the classic way an RLS assertion goes vacuous.
  it("reveals exactly one organisation's rows under that organisation's context", async () => {
    await assertATenantContextRevealsExactlyThatOrganisation(pool as pg.Pool);
  });
});
