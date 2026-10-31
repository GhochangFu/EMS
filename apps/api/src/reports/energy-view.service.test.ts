import { describe, it } from "vitest";

import {
  aGlobalAdminNamingNothingIsA400,
  aGlobalAdminReadsTheExplicitList,
  aGlobalReaderGetsNoPartial,
  aLocationWithNoZoneUsesTheOrganizations,
  aNonEmptyScopeReadsThePool,
  aScopedCallerGetsTheCounts,
  aSingleOrganizationCallerGetsThatOrganization,
  aStoredUtcIsComputedOnEtcUtc,
  anEmptyScopeTouchesNoPool,
  anInvalidZoneFallsToTheNextLink,
  anUnreadableOrganizationIsA403,
  compareReadsTwoPeriods,
  noCompareReadsOnePeriod,
  oneLocationNamedUsesItsZone,
  readableLocationsOfAnotherOrganizationAreA400,
  theReadsReceiveTheScopesAssetIds,
  theResponseCarriesCountsNeverIds,
  twoLocationsUseTheOrganizationsZone,
  unreadableLocationsAreA403BeforeTheOrganizationIsCompared,
} from "./energy-view.service.spec";

/** `F4.298` U4 — Vitest entry point for `EnergyViewService`. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.298 — EnergyViewService (ADR 0108 decision 2)", () => {
  describe("the organization rule", () => {
    it("a global admin naming nothing is a 400 naming organizationId", () => aGlobalAdminNamingNothingIsA400());
    it("a single-organization caller gets that organization", () => aSingleOrganizationCallerGetsThatOrganization());
    it("an organization the caller does not read is a 403", () => anUnreadableOrganizationIsA403());
    it("readable locations of another organization are a 400", () => readableLocationsOfAnotherOrganizationAreA400());
    it("unreadable locations are a 403 before the organization is compared", () =>
      unreadableLocationsAreA403BeforeTheOrganizationIsCompared());
  });

  describe("the zone chain", () => {
    it("one location named uses its zone", () => oneLocationNamedUsesItsZone());
    it("a location with no zone uses the organization's", () => aLocationWithNoZoneUsesTheOrganizations());
    it("a stored UTC is computed on Etc/UTC and reported as UTC", () => aStoredUtcIsComputedOnEtcUtc());
    it("two locations use the organization's zone", () => twoLocationsUseTheOrganizationsZone());
    it("an invalid zone falls to the next link", () => anInvalidZoneFallsToTheNextLink());
  });

  describe("compare and partial", () => {
    it("no compare reads one period", () => noCompareReadsOnePeriod());
    it("compare reads two periods that never overlap", () => compareReadsTwoPeriods());
    it("a global reader gets no partial", () => aGlobalReaderGetsNoPartial());
    it("a scoped caller gets the counts", () => aScopedCallerGetsTheCounts());
  });

  describe("the asset-id bound", () => {
    it("the reads receive the scope's asset ids", () => theReadsReceiveTheScopesAssetIds());
    it("a global admin reads the explicit list, never null", () => aGlobalAdminReadsTheExplicitList());
    it("an empty scope touches no pool", () => anEmptyScopeTouchesNoPool());
    it("a non-empty scope reads the pool", () => aNonEmptyScopeReadsThePool());
  });

  describe("counts, never ids", () => {
    it("the response carries counts, never an unreadable site id", () => theResponseCarriesCountsNeverIds());
  });
});
