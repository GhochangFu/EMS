import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { insertGlobalAdmin } from "../auth/location-asset-scope.integration.spec";
import { LocationAssetScopeService } from "../auth/location-asset-scope.service";
import { buildTreeFixture, type TreeFixture } from "../auth/location-tree.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  aParentWithUnreadableChildrenIsPartialAndExcludesTheirAssets,
  anInactiveChildIsNotCountedAsAnUnreadableSite,
  aReadableSiteWithAnotherOrganizationIsA400,
  aSiteOfAnotherOrganizationIsA403WithNoTelemetry,
  anotherOrganizationIdIsA403WithNoTelemetry,
  filterOptionsNeverListsAnotherOrganization,
  insertFutureSamples,
  organizationViewsAbnormalHoldsReadableEntitiesOnly,
  organizationViewsHeatmapHoldsReadableKwhOnly,
  organizationViewsOfAnotherOrganizationIdIsA403WithNoTelemetry,
  organizationViewsOfASiteOfAnotherOrganizationIsA403WithNoTelemetry,
  organizationViewsRankingHoldsReadableSitesOnly,
  organizationViewsTrendHoldsReadableSitesOnly,
  ownOrganizationWithAForeignSiteIsA403,
  recordingPool,
  type EnergyViewHarness,
} from "./energy-view.integration.spec";
import { EnergyOrganizationViewsService } from "./energy-organization-views.service";
import { EnergyViewService } from "./energy-view.service";
import { ReportScopeService } from "./report-scope";
import { ReportsController } from "./reports.controller";

/**
 * `F4.298` U4 — Vitest entry point for the energy view's owed cross-tenant and
 * partial cases. Assertions live in the sibling `.spec` (§4.6); this file owns
 * the one connection and the transaction the fixture lives in, the
 * `report-scope.integration.test.ts` shape: `max: 1`, every query inside
 * `BEGIN`, rolled back in `afterAll`.
 */

const connectionString = requireIntegrationDb({
  item: "F4.298",
  label: "energy view → caller scope",
  because:
    "a green run here would assert that the energy view never reads another organization's telemetry " +
    "and never names an unreadable site (ADR 0108's owed verification) while nothing checked it.",
  connection: "superuser",
});

describe.skipIf(!connectionString)("F4.298 — the energy view reads only the caller's scope", () => {
  const run = randomUUID().slice(0, 8);
  let pool: pg.Pool | undefined;
  let h: EnergyViewHarness;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.298", { max: 1 });
    const db = createDb(pool);
    const access = new AccessControlService(db, db);
    const scope = new ReportScopeService(db, access, new LocationAssetScopeService(db, access));
    const recorded = recordingPool(pool);
    const energyView = new EnergyViewService(
      recorded.pool,
      db,
      { resolveForAssets: async () => new Map<string, number>() },
      access,
      scope,
    );
    const organizationViews = new EnergyOrganizationViewsService(recorded.pool, energyView);
    const controller = new ReportsController({} as never, scope, energyView, organizationViews);
    await pool.query("BEGIN");
    await pool.query("SET LOCAL lock_timeout = '10s'");
    const fx: TreeFixture = await buildTreeFixture(pool, run);
    const admin: JwtPayload = await insertGlobalAdmin(pool, run);
    await insertFutureSamples(pool, fx);
    h = { controller, recorder: recorded.recorder, fx, admin };
  });

  afterAll(async () => {
    await pool?.query("ROLLBACK").catch(() => undefined);
    await pool?.end();
  });

  it("a parent with unreadable children is partial and excludes their assets", () =>
    aParentWithUnreadableChildrenIsPartialAndExcludesTheirAssets(h));
  it("an inactive child is not counted as an unreadable site", () =>
    anInactiveChildIsNotCountedAsAnUnreadableSite(h, pool as pg.Pool));
  it("organizationId of another organization is a 403 with no telemetry read", () => anotherOrganizationIdIsA403WithNoTelemetry(h));
  it("a site of another organization is a 403 with no telemetry read", () => aSiteOfAnotherOrganizationIsA403WithNoTelemetry(h));
  it("the own organization with a foreign site is a 403, not the mismatch 400", () => ownOrganizationWithAForeignSiteIsA403(h));
  it("a readable site with another organizationId is a 400", () => aReadableSiteWithAnotherOrganizationIsA400(h));
  it("filter-options never lists another organization", () => filterOptionsNeverListsAnotherOrganization(h));
  it("organization-views: organizationId of another organization is a 403 with no telemetry read", () =>
    organizationViewsOfAnotherOrganizationIdIsA403WithNoTelemetry(h));
  it("organization-views: a site of another organization is a 403 with no telemetry read", () =>
    organizationViewsOfASiteOfAnotherOrganizationIsA403WithNoTelemetry(h));
  it("organization-views: the ranking holds readable sites only", () => organizationViewsRankingHoldsReadableSitesOnly(h));
  it("organization-views: the trend holds readable sites only", () => organizationViewsTrendHoldsReadableSitesOnly(h));
  it("organization-views: the heatmap holds the readable kWh only", () => organizationViewsHeatmapHoldsReadableKwhOnly(h));
  it("organization-views: the abnormal list holds readable entities only", () =>
    organizationViewsAbnormalHoldsReadableEntitiesOnly(h));
});
