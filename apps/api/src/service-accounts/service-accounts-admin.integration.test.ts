import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertABelowOrganizationAdminIsRefused,
  assertAnOrganizationAdminCreatesAnAccountInItsOwnOrganizationOnly,
  assertARevokeIsFinalAndStopsTheToken,
  assertAServiceAccountCannotManageServiceAccounts,
  assertATokenIsShownOnceVerifiesAndIsCappedAtTwoLive,
  assertDisablingAnAccountRevokesEveryToken,
  assertGrantsAreHeldToTheAccountsOrganization,
  assertTheGlobalAdminIssuesAndRevokesInAnyOrganization,
  closeAdminSuite,
  openAdminSuite,
  type AdminSuite,
} from "./service-accounts-admin.integration.spec";

const connectionString = requireIntegrationDb({
  item: "F4.17",
  label: "the service-account admin service on the real pools",
  because:
    "every write runs on bms_tenant under RLS and migration 0145's guard trigger, the two-live-token cap " +
    "rests on a row lock, and the audit rows must carry no secret — none of which a fake can show.",
});

describe.skipIf(!connectionString)("F4.17 — /admin/service-accounts on a real database (ADR 0125 decisions 10–15)", () => {
  const pools: pg.Pool[] = [];
  let suite: AdminSuite;

  beforeAll(async () => {
    const url = connectionString as string;
    const open = async (u: string) => {
      const pool = await openIntegrationPool(u, "F4.17");
      pools.push(pool);
      return pool;
    };
    const superPool = await open(resolveIntegrationRoleUrl(url, "superuser", process.env));
    const fleetPool = await open(resolveIntegrationRoleUrl(url, "fleet", process.env));
    const authPool = await open(resolveIntegrationRoleUrl(url, "auth", process.env));
    const tenantPool = await open(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"));
    suite = await openAdminSuite(superPool, fleetPool, tenantPool, authPool);
  });

  afterAll(async () => {
    if (suite) await closeAdminSuite(suite);
    await Promise.all(pools.map((pool) => pool.end()));
  });

  it("an organization admin creates an account in its own organization only", async () => {
    await assertAnOrganizationAdminCreatesAnAccountInItsOwnOrganizationOnly(suite);
  });

  it("a role below organization admin, and a master-data role for the account, are refused", async () => {
    await assertABelowOrganizationAdminIsRefused(suite);
  });

  it("a token is shown once, verifies, and an account holds at most two live", async () => {
    await assertATokenIsShownOnceVerifiesAndIsCappedAtTwoLive(suite);
  });

  it("a revoke is final, stops the token, and frees its slot", async () => {
    await assertARevokeIsFinalAndStopsTheToken(suite);
  });

  it("disabling an account revokes every token, and re-enabling resurrects none", async () => {
    await assertDisablingAnAccountRevokesEveryToken(suite);
  });

  it("grants are held to the account's organization", async () => {
    await assertGrantsAreHeldToTheAccountsOrganization(suite);
  });

  it("the global admin issues and revokes in any organization; the audit names it", async () => {
    await assertTheGlobalAdminIssuesAndRevokesInAnyOrganization(suite);
  });

  it("a service account cannot manage service accounts", async () => {
    await assertAServiceAccountCannotManageServiceAccounts(suite);
  });
});
