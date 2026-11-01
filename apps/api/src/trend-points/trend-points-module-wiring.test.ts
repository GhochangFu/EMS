import { describe, it } from "vitest";

import {
  assertAppModuleImportsTrendPointsModule,
  assertControllerDepsResolve,
  assertModuleDeclaresBothControllers,
  assertModuleImportsDatabaseAndAuth,
  assertModuleProvidesServiceAndAudit,
  assertServiceDepsResolve,
  assertStripControllerDepsResolve,
  assertStripServiceDepsResolve,
} from "./trend-points-module-wiring.spec";

/** `F4.300` — the Nest module graph for `TrendPointsModule` (ADR 0108 decision 3). */
describe("F4.300 — TrendPointsModule wiring", () => {
  it("imports DatabaseModule and AuthModule", () => {
    assertModuleImportsDatabaseAndAuth();
  });

  it("provides TrendPointsService, MasterDataAuditService and SiteTrendStripService", () => {
    assertModuleProvidesServiceAndAudit();
  });

  it("declares SiteTrendPointsController, OrgTrendPointsAdminController and SiteTrendStripController", () => {
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
});
