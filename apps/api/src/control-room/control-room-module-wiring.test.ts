import { describe, it } from "vitest";

import {
  assertAdminModuleImportsControlRoomModule,
  assertAdminModuleProvidesTheOrganizationArm,
  assertAdminModuleProvidesTheSiteArm,
  assertAppModuleImportsControlRoomModule,
  assertControlRoomModuleDeclaresItsMembers,
  assertControlRoomModuleProvidesAndExportsSiteLayout,
  assertControlRoomModuleWiresTheOrganizationStrip,
  assertDashboardTemplatesControllerDepsResolveThroughAdmin,
  assertGeneratedSiteViewControllerDepsResolveWithinControlRoom,
  assertGeneratedSiteViewServiceDepsResolveWithinControlRoom,
  assertLocationsAdminControllerDepsResolveThroughAdmin,
  assertScanFindsTheServiceOnLocationsAdminController,
  assertOrganizationLayoutDepsResolveWithinControlRoom,
  assertServiceDepsResolveWithinControlRoom,
  assertSiteLayoutServiceDepsResolveWithinControlRoom,
  assertSiteViewControllerDepsResolveWithinControlRoom,
  assertTheOrganizationArmDelegatesToMake,
  assertTheSiteArmDelegatesToMakeForSite,
} from "./control-room-module-wiring.spec";

/**
 * `F3.67` U4 — the Nest module graph for `ControlRoomModule`,
 * `AdminModule`'s two new `LocationsAdminController` handlers, and
 * `AppModule`'s `SiteViewController` route (ADR 0076 decision 5, plan D4).
 */
describe("F3.67 — ControlRoomModule wiring", () => {
  it("declares SiteViewController and GeneratedSiteViewController, provides their services, exports the shared one", () => {
    assertControlRoomModuleDeclaresItsMembers();
  });

  it("AdminModule imports ControlRoomModule", () => {
    assertAdminModuleImportsControlRoomModule();
  });

  it("AppModule imports ControlRoomModule", () => {
    assertAppModuleImportsControlRoomModule();
  });

  it("positive control — the scan finds SiteControlRoomViewService on LocationsAdminController", () => {
    assertScanFindsTheServiceOnLocationsAdminController();
  });

  it("LocationsAdminController's dependencies resolve inside AdminModule's scope", () => {
    assertLocationsAdminControllerDepsResolveThroughAdmin();
  });

  it("SiteViewController's dependencies resolve inside ControlRoomModule's own scope", () => {
    assertSiteViewControllerDepsResolveWithinControlRoom();
  });

  it("SiteControlRoomViewService's own dependencies resolve inside ControlRoomModule's scope", () => {
    assertServiceDepsResolveWithinControlRoom();
  });

  it("F3.68 GeneratedSiteViewController's dependencies resolve inside ControlRoomModule's own scope", () => {
    assertGeneratedSiteViewControllerDepsResolveWithinControlRoom();
  });

  it("F3.68 GeneratedSiteViewService's own dependencies resolve inside ControlRoomModule's scope", () => {
    assertGeneratedSiteViewServiceDepsResolveWithinControlRoom();
  });

  it("F3.73 provides and exports SiteLayoutService", () => {
    assertControlRoomModuleProvidesAndExportsSiteLayout();
  });

  it("F3.73 SiteLayoutService's own dependencies resolve inside ControlRoomModule's scope", () => {
    assertSiteLayoutServiceDepsResolveWithinControlRoom();
  });

  it("F3.73 DashboardTemplatesController's dependencies resolve inside AdminModule's scope", () => {
    assertDashboardTemplatesControllerDepsResolveThroughAdmin();
  });

  it("F3.73 AdminModule fills the SITE_TEMPLATE_ARM seam from SiteLayoutService", () => {
    assertAdminModuleProvidesTheSiteArm();
  });

  it("F3.73 the site arm forwards the location, the template and the choice to makeForSite", async () => {
    await assertTheSiteArmDelegatesToMakeForSite();
  });

  it("F4.317 declares the organization view controller and provides, exports and resolves the strip's service", () => {
    assertControlRoomModuleWiresTheOrganizationStrip();
  });

  it("F4.317 OrganizationViewController's and OrganizationLayoutService's dependencies resolve", () => {
    assertOrganizationLayoutDepsResolveWithinControlRoom();
  });

  it("F4.317 AdminModule fills the ORGANIZATION_TEMPLATE_ARM seam from OrganizationLayoutService", () => {
    assertAdminModuleProvidesTheOrganizationArm();
  });

  it("F4.317 the organization arm forwards the organization and the template to make", async () => {
    await assertTheOrganizationArmDelegatesToMake();
  });
});
