import { describe, it } from "vitest";

import {
  aLocationNotFoundIsA400,
  aLocationOutsideTheGrantIsA403,
  aScopedCallerNeverReadsTheLocationsOrganizations,
  locationsOfSeveralOrganizationsAreA400,
  namedSitesReadTheSubtreesReadableAssets,
  noLocationIdsNeverCallsTheLocationService,
  noLocationIdsReadsTheCallersReadableAssets,
  placeForCallerKeepsTheAdminsNotFoundA400,
  placeForCallerKeepsTheOrganization,
  placeForCallerOutsideTheGrantIsA403,
  placeForCallerRefusesAForeignLocationWithA403,
  theCandidatesAreTheCallersReadableOrganizations,
  theGlobalAdminsCandidatesAreTheLocationsOrganizations,
  theSavesReadIsBoundToItsOrganization,
} from "./report-scope.spec";

/** `F4.290` — Vitest entry point for the report site filter's seam. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.290 — ReportScopeService (ADR 0099 Amendment 9 E4)", () => {
  it("no locationIds reads the caller's readable assets", () => noLocationIdsReadsTheCallersReadableAssets());
  it("no locationIds never calls the location service", () => noLocationIdsNeverCallsTheLocationService());
  it("named sites read the subtrees' readable assets", () => namedSitesReadTheSubtreesReadableAssets());
  it("the candidates are the caller's readable organizations", () => theCandidatesAreTheCallersReadableOrganizations());
  it("the global admin's candidates are the locations' organizations", () => theGlobalAdminsCandidatesAreTheLocationsOrganizations());
  it("a scoped caller never reads the locations' organizations", () => aScopedCallerNeverReadsTheLocationsOrganizations());
  it("a location not found is a 400", () => aLocationNotFoundIsA400());
  it("a location outside the grant is a 403", () => aLocationOutsideTheGrantIsA403());
  it("locations of several organizations are a 400", () => locationsOfSeveralOrganizationsAreA400());
  it("the save's read is bound to its organization", () => theSavesReadIsBoundToItsOrganization());

  describe("F4.298 — placeForCaller (ADR 0108 decision 2.2)", () => {
    it("keeps the organization the locations resolved to", () => placeForCallerKeepsTheOrganization());
    it("a scoped caller's foreign location is a 403, with no fleet read", () => placeForCallerRefusesAForeignLocationWithA403());
    it("the global admin's unknown location stays a 400", () => placeForCallerKeepsTheAdminsNotFoundA400());
    it("outside the grant is a 403", () => placeForCallerOutsideTheGrantIsA403());
  });
});
