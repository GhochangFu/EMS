import { describe, it } from "vitest";

import {
  assertControllerDepsResolveWithinTheModule,
  assertControllerTakesDashboardWidgetAppendService,
  assertControllerTakesMimicNodesService,
  assertDashboardWidgetAppendServiceDepsResolveWithinTheModule,
  assertModuleProvidesDashboardWidgetAppendService,
  assertMimicNodesServiceDepsResolveWithinTheModule,
  assertMimicNodesServiceInjectsFleetDrizzleThenFleetPool,
  assertModuleProvidesMimicNodesService,
  assertModuleProvidesSiteWidgetsService,
  assertControllerTakesSiteWidgetsService,
  assertSiteWidgetsServiceDepsResolveWithinTheModule,
  assertDashboardsServiceTakesTrendPointsService,
  assertModuleProvidesTrendPointsService,
  assertTrendPointsServiceDepsResolveWithinTheModule,
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

  it("provides DashboardWidgetAppendService (F4.303)", () => {
    assertModuleProvidesDashboardWidgetAppendService();
  });

  it("DashboardWidgetAppendService's dependencies resolve inside the module's scope (F4.303)", () => {
    assertDashboardWidgetAppendServiceDepsResolveWithinTheModule();
  });

  it("positive control — DashboardBuilderController takes a DashboardWidgetAppendService parameter (F4.303)", () => {
    assertControllerTakesDashboardWidgetAppendService();
  });

  it("provides TrendPointsService (F4.306)", () => {
    assertModuleProvidesTrendPointsService();
  });

  it("TrendPointsService's dependencies resolve inside the module's scope (F4.306)", () => {
    assertTrendPointsServiceDepsResolveWithinTheModule();
  });

  it("positive control — DashboardsService takes a TrendPointsService parameter that resolves (F4.306)", () => {
    assertDashboardsServiceTakesTrendPointsService();
  });
});
