import { describe, it } from "vitest";

import {
  aCreateOutsideTheWritableSetIsRefused,
  aLocationAdminCoveringEveryStampedLocationResolves,
  aLocationAdminCreatesInItsOrganization,
  aLocationAdminMissingAStampedLocationIsRefused,
  anAdminResolvesTheScheduleByName,
  anAssetGroupAdminIsRefusedTheCreate,
  anAssetGroupAdminIsRefusedTheSchedule,
  anOperatorIsRefusedTheSchedule,
  anOrganizationAdminOfAnotherOrganizationIsRefused,
  aViewerIsRefusedTheSchedule,
  theFileSaveOutsideTheWritableSetIsRefused,
  theFileSaveResolvesOnTheReportGate,
  theScheduleGateAsksInTheRoutesOrder,
} from "./copilot-target-resolver.reports.spec";

/** `F4.280` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.280 — the report targets mirror the routes' gate (ADR 0099 Amendment 8 D2)", () => {
  it("refuses an asset_group_admin a schedule", () => anAssetGroupAdminIsRefusedTheSchedule());
  it("refuses an operator a schedule", () => anOperatorIsRefusedTheSchedule());
  it("refuses a viewer a schedule", () => aViewerIsRefusedTheSchedule());
  it("refuses a location_admin missing a stamped location", () => aLocationAdminMissingAStampedLocationIsRefused());
  it("resolves a location_admin covering every stamped location", () => aLocationAdminCoveringEveryStampedLocationResolves());
  it("refuses an organization_admin of another organization", () => anOrganizationAdminOfAnotherOrganizationIsRefused());
  it("resolves a global admin, named by the schedule", () => anAdminResolvesTheScheduleByName());
  it("asks the role gate, then the verdict with the stamped locations", () => theScheduleGateAsksInTheRoutesOrder());
  it("resolves a location_admin's create in its organization", () => aLocationAdminCreatesInItsOrganization());
  it("refuses a create outside the writable set", () => aCreateOutsideTheWritableSetIsRefused());
  it("refuses an asset_group_admin a create", () => anAssetGroupAdminIsRefusedTheCreate());
  it("resolves the file save on the report gate", () => theFileSaveResolvesOnTheReportGate());
  it("refuses the file save outside the writable set", () => theFileSaveOutsideTheWritableSetIsRefused());
});
