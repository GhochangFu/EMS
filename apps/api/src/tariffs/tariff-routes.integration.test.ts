import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertAForeignMeterIs400,
  assertALocationAdminWritesItsSubtreeOnly,
  assertAMappingWriteIsAuditedOnce,
  assertAnOverlapIs409,
  assertASlashKeyRoundTrips,
  assertAViewerReadsCategoriesAndTheBill,
  assertUnreadableLocationAndMeterAreOne404,
  assertUpdateAndDeleteAreAudited,
  buildServices,
  dropRoutesFixture,
  seedRoutesFixture,
  type RoutesCtx,
} from "./tariff-routes.integration.spec";

/**
 * `F4.365` U5 — Vitest entry point; assertions live in the sibling `.spec`
 * (ADR 0014). The cases run in order and share the SITE mapping through `ctx`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.365",
  label: "the tariff read routes and the location mapping API",
  because:
    "the read gates, the subtree meter rule, the overlap 409 and the audit row are database behaviours a pure test cannot check.",
  connection: "owner",
});

describe.skipIf(!connectionString)("F4.365 — tariff routes and location mappings (ADR 0134)", () => {
  const run = randomUUID().slice(0, 8);
  const pools: pg.Pool[] = [];
  let ctx: RoutesCtx | undefined;
  let superuser: pg.Pool | undefined;
  const use = (): RoutesCtx => {
    if (!ctx) throw new Error("F4.365 U5: the fixture was not built");
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
    await dropRoutesFixture(superuser, run);
    const fx = await seedRoutesFixture(superuser, run);
    const services = buildServices({ fleet, auth, tenant });
    ctx = { fx, superuser, lines: services.lines, bills: services.bills, mappings: services.mappings };
  }, 120_000);

  afterAll(async () => {
    if (superuser) await dropRoutesFixture(superuser, run);
    await Promise.all(pools.map((p) => p.end()));
  }, 120_000);

  it("a mapping write leaves exactly one audit row with the organization stamped", () => assertAMappingWriteIsAuditedOnce(use()));
  it("an overlapping mapping is a 409 and writes nothing", () => assertAnOverlapIs409(use()));
  it("a location_admin writes its own subtree and is 403 on a sibling; a viewer cannot list", () =>
    assertALocationAdminWritesItsSubtreeOnly(use()));
  it("a foreign or out-of-subtree meter is one 400; an unknown key or a wrong load unit is a 400", () => assertAForeignMeterIs400(use()));
  it("a viewer reads categories (state= narrows) and a readable location's bill", () => assertAViewerReadsCategoriesAndTheBill(use()));
  it("an unreadable location and an unreadable billing meter are the same 404", () => assertUnreadableLocationAndMeterAreOne404(use()));
  it("a key containing / round-trips through the versions read", () => assertASlashKeyRoundTrips(use()));
  it("update and delete are audited; a mapping under another location is a 404", () => assertUpdateAndDeleteAreAudited(use()));
});
