import { describe, it } from "vitest";

import {
  assertAppModuleImportsTrendPointsModule,
  assertControllerDepsResolve,
  assertModuleDeclaresBothControllers,
  assertModuleImportsDatabaseAndAuth,
  assertModuleProvidesServiceAndAudit,
  assertSegmentViewsControllerDepsResolve,
  assertSegmentViewsServiceDepsResolve,
  assertServiceDepsResolve,
  assertStripControllerDepsResolve,
  assertStripServiceDepsResolve,
} from "./trend-points-module-wiring.spec";

/** `F4.300` — the Nest module graph for `TrendPointsModule` (ADR 0108 decision 3). */
describe("F4.300 — TrendPointsModule wiring", () => {
  it("imports DatabaseModule and AuthModule", () => {
    assertModuleImportsDatabaseAndAuth();
  });

  it("provides TrendPointsService, MasterDataAuditService, SiteTrendStripService and SiteSegmentViewsService", () => {
    assertModuleProvidesServiceAndAudit();
  });

  it("declares the trend-points, admin, trend-strip and segment-views controllers", () => {
    assertModuleDeclaresBothControllers();
  });

  it("AppModule imports TrendPointsModule", () => {
    assertAppModuleImportsTrendPointsModule();
  });

  it("each controller injects only TrendPointsService, resolvable in the module", () => {
    assertControllerDepsResolve();
  });

  it("TrendPointsService's own dependencies resolve inside the module", () => {
    assertServiceDepsResolve();
  });

  it("F4.301: SiteTrendStripController injects only SiteTrendStripService, resolvable in the module", () => {
    assertStripControllerDepsResolve();
  });

  it("F4.301: SiteTrendStripService's own dependencies resolve inside the module", () => {
    assertStripServiceDepsResolve();
  });

  it("F4.302: SiteSegmentViewsController injects only SiteSegmentViewsService, resolvable in the module", () => {
    assertSegmentViewsControllerDepsResolve();
  });

  it("F4.302: SiteSegmentViewsService's own dependencies resolve inside the module", () => {
    assertSegmentViewsServiceDepsResolve();
  });
});
