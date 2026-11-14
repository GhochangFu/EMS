import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertALocationAdminIs403,
  assertAnOrganizationAdminCreatesRevisionAndCustom,
  assertAnotherOrganizationSeesNothing,
  assertARevisionRefusesDescriptiveColumns,
  assertAVersionInForceIsLocked,
  dropVersionsFixture,
  seedVersionsFixture,
  type VersionsCtx,
} from "./org-tariff-versions.integration.spec";

/**
 * `F4.365` U6 — Vitest entry point; assertions live in the sibling `.spec`
 * (ADR 0014). The cases run in order and share ids through `ctx`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.365",
  label: "organization tariff versions",
  because: "the organization-admin gate, the in-force lock, tenant isolation and the audit rows are database behaviours.",
  connection: "owner",
});

describe.skipIf(!connectionString)("F4.365 — organization tariff versions (ADR 0134 Amendment 1)", () => {
  const run = randomUUID().slice(0, 8);
  const pools: pg.Pool[] = [];
  let ctx: VersionsCtx | undefined;
  let superuser: pg.Pool | undefined;
  const use = (): VersionsCtx => {
    if (!ctx) throw new Error("F4.365 U6: the fixture was not built");
    return ctx;
  };

  beforeAll(async () => {
    const url = connectionString as string;
    superuser = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.365");
    pools.push(superuser);
    const fleet = await openIntegrationPool(resolveIntegrationRoleUrl(url, "fleet", process.env), "F4.365");
    const auth = await openIntegrationPool(resolveIntegrationRoleUrl(url, "auth", process.env), "F4.365");
    const tenant = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F4.365");
    pools.push(fleet, auth, tenant);
    await dropVersionsFixture(superuser, run);
    ctx = await seedVersionsFixture({ superuser, fleet, auth, tenant }, run);
  }, 120_000);

  afterAll(async () => {
    if (superuser) await dropVersionsFixture(superuser, run);
    await Promise.all(pools.map((p) => p.end()));
  }, 120_000);

  it("an organization_admin creates a revision and a custom line, each audited once with its reason; a duplicate is 409", () =>
    assertAnOrganizationAdminCreatesRevisionAndCustom(use()));
  it("a location_admin is 403", () => assertALocationAdminIs403(use()));
  it("organization B cannot read, patch or delete A's version", () => assertAnotherOrganizationSeesNothing(use()));
  it("a version in force is 409 on PATCH and DELETE; a next-month one is edited and deleted, audited with reasons", () =>
    assertAVersionInForceIsLocked(use()));
  it("a revision body that sends state is a 400 (.strict())", () => assertARevisionRefusesDescriptiveColumns(use()));
});
