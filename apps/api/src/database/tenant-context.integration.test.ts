import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertFleetSeesEveryOrganization,
  assertTenantDoesNotLeakAcrossPooledRequests,
  assertTenantSeesOnlyItsOwnLocations,
  assertTenantWithoutContextSeesNothing,
  assertWithTenantScopesAndDoesNotLeak,
} from "./tenant-context.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

const connectionString = requireIntegrationDb({
  item: "F4.16",
  label: "tenant-context tests",
  because:
    "they are the only proof that a tenant connection sees one organization, that a " +
    "pooled connection does not carry the previous request's tenant to the next caller, " +
    "and that a connection with no tenant set sees nothing rather than everything.",
});

/**
 * The tenant and fleet URLs are derived from `DATABASE_URL` by swapping the
 * credentials, so a developer sets one variable rather than three. Passwords are
 * the compose defaults; `pnpm --filter @bms/db roles` must have run.
 */
function asRole(url: string, role: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = role;
  parsed.password = password;
  return parsed.toString();
}

describe.skipIf(!connectionString)("F4.16 — tenant context", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let organizationIds: string[];

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F4.16");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.16",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F4.16",
    );
    const { rows } = await ownerPool.query<{ id: string }>(
      "select id from bms.organizations order by code limit 2",
    );
    organizationIds = rows.map((r) => r.id);
    if (organizationIds.length < 2) {
      throw new Error(
        "F4.16 tenant-context tests need two seeded organizations; run pnpm db:seed.",
      );
    }
  });

  afterAll(async () => {
    await Promise.all([ownerPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("shows a tenant connection only its own organization", async () => {
    await assertTenantSeesOnlyItsOwnLocations(
      tenantPool,
      organizationIds[0],
      organizationIds[1],
    );
  });

  it("does not carry one request's tenant to the next on the same connection", async () => {
    await assertTenantDoesNotLeakAcrossPooledRequests(
      tenantPool,
      organizationIds[0],
      organizationIds[1],
    );
  });

  it("shows nothing when no organization is set, and rows when one is", async () => {
    await assertTenantWithoutContextSeesNothing(tenantPool, organizationIds[0]);
  });

  it("shows every organization to bms_fleet", async () => {
    await assertFleetSeesEveryOrganization(fleetPool, organizationIds);
  });

  it("scopes through withTenant and leaves nothing set afterwards", async () => {
    await assertWithTenantScopesAndDoesNotLeak(
      tenantPool,
      organizationIds[0],
      organizationIds[1],
    );
  });
});
