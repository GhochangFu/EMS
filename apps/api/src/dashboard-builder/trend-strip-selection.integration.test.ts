import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { primeSeededSubjects } from "../testing/seeded-subjects";
import { TrendPointsService } from "../trend-points/trend-points.service";
import { DashboardsService } from "./dashboards.service";
import {
  aPointOffTheListIsRefusedNamingTheIndex,
  aStripWithoutSelectionNeverReadsTheLists,
  aValidSelectionSavesAndReadsBackEqual,
  type TrendStripSelectionFixture,
} from "./trend-strip-selection.integration.spec";

/**
 * `F4.306` U5 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this file
 * owns the database lifecycle, this run's site dashboard and its cleanup. The service is built
 * with a `TrendPointsService` that counts its `effective` reads, so "no selection, no read" is a
 * count, not an inference.
 */
const connectionString = requireIntegrationDb({
  item: "F4.306",
  label: "DashboardsService — a trend strip selection against the organization's lists",
  because:
    "the check reads the organization's effective trend-point lists, which F4.300 resolves from " +
    "asset_domains, point_keys and org_trend_points rows, a fact about a real database.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F4.306 — a trend strip selection on putWidgets, against a real database", () => {
  let fleetPool: pg.Pool;
  let superuserPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  const dashboardIds: string[] = [];
  let f: TrendStripSelectionFixture;

  beforeAll(async () => {
    const url = connectionString as string;
    const POOL = { max: 2 } as const;
    fleetPool = await openIntegrationPool(url, "F4.306", POOL);
    await primeSeededSubjects(fleetPool);
    superuserPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.306", POOL);
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.306",
      POOL,
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.306",
      POOL,
    );
    const fleetDb = createDb(fleetPool);
    const tenantDb = createDb(tenantPool);

    const org = await fleetPool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM'`);
    const organizationId = org.rows[0]?.id ?? "";
    // A seeded asset named by code (the fixture-isolation gate): its site hosts the dashboard.
    const site = await fleetPool.query<{ location_id: string }>(
      `SELECT a.location_id FROM bms.assets a WHERE a.organization_id = $1 AND a.code = 'CR-Q1'`,
      [organizationId],
    );
    const here = site.rows[0]?.location_id;
    if (!organizationId || !here) {
      throw new Error("F4.306: ESKOM's seeded asset CR-Q1 not found — run pnpm db:seed");
    }

    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    let calls = 0;
    class CountingTrendPoints extends TrendPointsService {
      override async effective(...args: Parameters<TrendPointsService["effective"]>) {
        calls += 1;
        return super.effective(...args);
      }
    }
    const trendPoints = new CountingTrendPoints(fleetDb, tenantDb, accessControl, audit);
    const listed = (await trendPoints.effective(organizationId, {})).find((segment) => segment.points.length > 0);
    if (!listed?.points[0]) {
      throw new Error("F4.306: no segment of ESKOM has an effective trend point — run pnpm db:seed");
    }
    const service = new DashboardsService(tenantDb, fleetDb, accessControl, audit, trendPoints);
    const actor = jwtFor(SEEDED.globalAdmin, "admin");
    const created = await service.create(actor, {
      organizationId,
      slug: `f4306-strip-selection-${RUN}`,
      name: "F4.306 strip-selection fixture",
      locationId: here,
    } as Parameters<DashboardsService["create"]>[1]);
    dashboardIds.push(created.id);

    f = {
      service,
      actor,
      dashboardId: created.id,
      segment: listed.domain,
      pointCode: listed.points[0].code,
      effectiveCalls: () => calls,
    };
  }, 60_000);

  afterAll(async () => {
    if (dashboardIds.length > 0) {
      await superuserPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [dashboardIds]);
      await superuserPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [dashboardIds]);
    }
    await Promise.all([fleetPool, superuserPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("a valid selection saves and reads back equal, lists in order", async () => {
    await aValidSelectionSavesAndReadsBackEqual(f);
  }, 60_000);

  it("a point off its list is a 400 naming the index, never the code", async () => {
    await aPointOffTheListIsRefusedNamingTheIndex(f);
  }, 60_000);

  it("a trend strip without a selection never reads the lists", async () => {
    await aStripWithoutSelectionNeverReadsTheLists(f);
  }, 60_000);
});
