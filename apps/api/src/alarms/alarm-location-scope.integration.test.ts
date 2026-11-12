import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import * as spec from "./alarm-location-scope.integration.spec";
import type { AlarmsGateway } from "./alarms.gateway";
import { AlarmsService } from "./alarms.service";

/**
 * `F4.357` U2 — Vitest entry point for `locationId` on the alarm list and
 * summary. Assertions live in the sibling `.spec` (ADR 0014). The service runs
 * on the real `bms_tenant` / `bms_fleet` pair, as
 * `alarm-list-filters.integration.test.ts` builds it.
 */
const connectionString = requireIntegrationDb({
  item: "F4.357",
  label: "AlarmsService.list and the summary filter by a location subtree",
  because:
    "the alarm bar of a site page counts the alarms of that site and its sub-locations through this " +
    "filter; a green run without a database would claim the subtree, the RTU arm and the P2 rule hold " +
    "while nothing ran the SQL.",
});

const gatewayStub = { broadcastAcknowledged: () => undefined } as unknown as AlarmsGateway;

describe.skipIf(!connectionString)("F4.357 — the alarm list and summary filter by a location subtree (ADR 0130 decision 15)", () => {
  const run = randomUUID().replace(/-/g, "").slice(0, 10);
  let pools: pg.Pool[] = [];
  let admin: pg.Pool | undefined;
  const organizations: string[] = [];
  let fx: spec.LocationScopeFixture | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    const fleetPool = await openIntegrationPool(url, "F4.357");
    const tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.357",
    );
    admin = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.357");
    pools = [fleetPool, tenantPool, admin];
    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const svc = new AlarmsService(tenantDb, fleetDb, gatewayStub, new MasterDataAuditService(tenantDb, fleetDb));
    fx = await spec.buildLocationScopeFixture(admin, run, svc, (id) => organizations.push(id));
  });

  afterAll(async () => {
    if (admin) for (const id of organizations) await spec.dropLocationScopeFixture(admin, id);
    await Promise.all(pools.map((pool) => pool.end()));
  });

  const fixture = (): spec.LocationScopeFixture => fx ?? (() => { throw new Error("F4.357: the fixture was not built"); })();

  it("1 the organization lists every active alarm, the host alarm included", () => spec.assertTheOrganizationListsEveryActiveAlarm(fixture()));
  it("2 a site lists its subtree's rule alarms and its RTU's comms alarm", () => spec.assertTheSiteListsItsSubtree(fixture()));
  it("3 a child lists its own alarms only", () => spec.assertTheChildListsItselfOnly(fixture()));
  it("4 the site summary agrees with the list, per severity", () => spec.assertTheSiteSummaryAgreesWithTheList(fixture()));
  it("5 the read scope still binds inside the location", () => spec.assertTheReadScopeStillBinds(fixture()));
  it("6 an unreadable ancestor answers nothing (owner ruling P2)", () => spec.assertAnUnreadableAncestorAnswersNothing(fixture()));
  it("7 a foreign organization's site answers nothing", () => spec.assertAForeignSiteAnswersNothing(fixture()));
  it("8 the subtree holds on the tenant path", () => spec.assertTheSubtreeHoldsOnTheTenantPath(fixture()));
  it("9 a location of another organization than organizationId answers nothing", () =>
    spec.assertALocationOfAnotherOrganizationAnswersNothing(fixture()));
});
