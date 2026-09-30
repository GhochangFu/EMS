import { describe, it } from "vitest";

import {
  assertControllerDepsResolveWithinTheModule,
  assertControllerTakesMimicNodesService,
  assertMimicNodesServiceDepsResolveWithinTheModule,
  assertMimicNodesServiceInjectsFleetDrizzleThenFleetPool,
  assertModuleProvidesMimicNodesService,
  assertModuleProvidesSiteWidgetsService,
  assertControllerTakesSiteWidgetsService,
  assertSiteWidgetsServiceDepsResolveWithinTheModule,
} from "./dashboard-builder-module-wiring.spec";

/** `F3.32` U2 — `DashboardBuilderModule` wiring for `MimicNodesService` (ADR 0079, plan D1). */
describe("F3.32 — DashboardBuilderModule wiring", () => {
  it("provides MimicNodesService", () => {
    assertModuleProvidesMimicNodesService();
  });

  it("MimicNodesService injects FLEET_DRIZZLE then FLEET_POOL", () => {
    assertMimicNodesServiceInjectsFleetDrizzleThenFleetPool();
  });

  it("MimicNodesService's dependencies resolve inside the module's scope", () => {
    assertMimicNodesServiceDepsResolveWithinTheModule();
  });

  it("positive control — DashboardBuilderController takes a MimicNodesService parameter", () => {
    assertControllerTakesMimicNodesService();
  });

  it("DashboardBuilderController's class-typed dependencies resolve inside the module's scope", () => {
    assertControllerDepsResolveWithinTheModule();
  });

  it("provides SiteWidgetsService and AssetRoleSummaryService (F3.73)", () => {
    assertModuleProvidesSiteWidgetsService();
  });

  it("SiteWidgetsService's dependencies resolve inside the module's scope (F3.73)", () => {
    assertSiteWidgetsServiceDepsResolveWithinTheModule();
  });

  it("positive control — DashboardBuilderController takes a SiteWidgetsService parameter (F3.73)", () => {
    assertControllerTakesSiteWidgetsService();
  });
});
