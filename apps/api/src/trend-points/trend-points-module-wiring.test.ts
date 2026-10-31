import { describe, it } from "vitest";

import {
  assertAppModuleImportsTrendPointsModule,
  assertControllerDepsResolve,
  assertModuleDeclaresBothControllers,
  assertModuleImportsDatabaseAndAuth,
  assertModuleProvidesServiceAndAudit,
  assertServiceDepsResolve,
} from "./trend-points-module-wiring.spec";

/** `F4.300` — the Nest module graph for `TrendPointsModule` (ADR 0108 decision 3). */
describe("F4.300 — TrendPointsModule wiring", () => {
  it("imports DatabaseModule and AuthModule", () => {
    assertModuleImportsDatabaseAndAuth();
  });

  it("provides TrendPointsService and MasterDataAuditService", () => {
    assertModuleProvidesServiceAndAudit();
  });

  it("declares SiteTrendPointsController and OrgTrendPointsAdminController", () => {
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
});
