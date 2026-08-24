import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "./access-control.service";
import {
  assertAssetGroupAdminScopeSurvivesRealRls,
  assertGlobalAdminScopeSurvivesRealRls,
  assertLocationAdminScopeSurvivesRealRls,
  assertOrganizationAdminScopeSurvivesRealRls,
  assertOrganizationAdminStillIsolatedUnderRealRls,
} from "./access-control-rls.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F4.16` — Vitest entry point. Assertions live in the sibling `.spec` (ADR
 * 0014). See that file's header for why this suite exists alongside
 * `access-control.integration.test.ts` rather than replacing it.
 */

const connectionString = requireIntegrationDb({
  item: "F4.16",
  label: "AccessControlService against real, non-owner roles",
  because:
    "access-control.integration.test.ts passes the owner as all three pools, which cannot " +
    "tell RLS enforced from RLS bypassed apart. This is the only suite that constructs " +
    "AccessControlService with real bms_auth/bms_tenant/bms_fleet connections, and it is " +
    "what would have caught the empty-scope regression before it reached compose.",
});

/**
 * Tenant/fleet URLs derived from `DATABASE_URL` by swapping credentials, so a
 * developer sets one variable. Passwords are the compose defaults; `pnpm
 * --filter @bms/db roles` must have run.
 */
function asRole(url: string, role: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = role;
  parsed.password = password;
  return parsed.toString();
}

describe.skipIf(!connectionString)(
  "F4.16 — AccessControlService against real, non-owner roles",
  () => {
    let ownerPool: pg.Pool;
    let authPool: pg.Pool;
    let tenantPool: pg.Pool;
    let fleetPool: pg.Pool;
    let svc: AccessControlService;
    let activeLocationCount: number;

    beforeAll(async () => {
      const url = connectionString as string;
      ownerPool = await openIntegrationPool(url, "F4.16");
      authPool = await openIntegrationPool(
        process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
        "F4.16",
      );
      tenantPool = await openIntegrationPool(
        process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
        "F4.16",
      );
      fleetPool = await openIntegrationPool(
        process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
        "F4.16",
      );
      svc = new AccessControlService(
        createDb(authPool),
        createDb(tenantPool),
        createDb(fleetPool),
      );

      const { rows } = await ownerPool.query<{ count: string }>(
        "select count(*)::text as count from bms.locations where active = true",
      );
      activeLocationCount = Number(rows[0]?.count ?? 0);
    });

    afterAll(async () => {
      await Promise.all([
        ownerPool?.end(),
        authPool?.end(),
        tenantPool?.end(),
        fleetPool?.end(),
      ]);
    });

    it("gives a real location_admin its granted locations and assets, not an empty scope", async () => {
      await assertLocationAdminScopeSurvivesRealRls(svc);
    });

    it("gives a real organization_admin its granted locations, not an empty scope", async () => {
      await assertOrganizationAdminScopeSurvivesRealRls(svc);
    });

    it("gives a real asset_group_admin its granted groups and assets, not an empty scope", async () => {
      await assertAssetGroupAdminScopeSurvivesRealRls(svc);
    });

    it("gives a real global admin every active location via the fleet pool", async () => {
      await assertGlobalAdminScopeSurvivesRealRls(svc, activeLocationCount);
    });

    it("still isolates an organization_admin from another organization's locations", async () => {
      await assertOrganizationAdminStillIsolatedUnderRealRls(svc);
    });
  },
);
