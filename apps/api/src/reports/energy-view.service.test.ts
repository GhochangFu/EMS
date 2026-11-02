import { describe, it } from "vitest";

import {
  aGlobalAdminNamingNothingIsA400,
  aNamedLocationWithNoAreaIsNull,
  noAreaIsANullFigure,
  noOwnAssetRowIsANullFigureThoughTheSubtreeHasData,
  oneNamedLocationCarriesItsArea,
  theAreaAddsNoPoolStatement,
  theComparePeriodCarriesItsOwnFigure,
  theFigureDividesTheOwnAssetsKwhOnly,
  theFigureIsComputedOnTheUnroundedKwh,
  theFrameCarriesTheResponsesArea,
  theZoneAndTheAreaAreOneSelect,
  twoNamedLocationsCarryNoArea,
  aGlobalAdminReadsTheExplicitList,
  aGlobalReaderGetsNoPartial,
  aLocationWithNoZoneUsesTheOrganizations,
  aNonEmptyScopeReadsThePool,
  aScopedCallerGetsTheCounts,
  anInactiveChildIsDroppedBeforeTheCount,
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
  theFrameMatchesTheResponse,
  theResponseCarriesCountsNeverIds,
  twoLocationsUseTheOrganizationsZone,
  unreadableLocationsAreA403BeforeTheOrganizationIsCompared,
  viewCallsFrameOnce,
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
    it("an inactive child is dropped before the count", () => anInactiveChildIsDroppedBeforeTheCount());
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

  describe("the frame (F4.299 U2, ADR 0108 Amendment 1, 7.2)", () => {
    it("view() resolves its frame through frame() once, with the user and the query", () => viewCallsFrameOnce());
    it("the frame's organization, scope, level, bucket, zone and partial are the response's", () =>
      theFrameMatchesTheResponse());
  });

  describe("kWh per m² (F4.304, ADR 0108 Amendment 5 item 8)", () => {
    it("V1 one named location carries its area as a number", () => oneNamedLocationCarriesItsArea());
    it("V1' a named location with no area carries null", () => aNamedLocationWithNoAreaIsNull());
    it("V2 two named locations carry no area and no figure", () => twoNamedLocationsCarryNoArea());
    it("V3 the zone and the area come from one locations select", () => theZoneAndTheAreaAreOneSelect());
    it("V3' the area adds no pool statement", () => theAreaAddsNoPoolStatement());
    it("V4 the figure divides the site's own assets' kWh only", () => theFigureDividesTheOwnAssetsKwhOnly());
    it("V5 no area is a null figure", () => noAreaIsANullFigure());
    it("V6 no own-asset row is a null figure though the subtree has data", () =>
      noOwnAssetRowIsANullFigureThoughTheSubtreeHasData());
    it("V7 the compare period carries its own figure on the same area", () => theComparePeriodCarriesItsOwnFigure());
    it("V8 the figure is computed on the unrounded kWh", () => theFigureIsComputedOnTheUnroundedKwh());
    it("V9 the frame carries the response's area", () => theFrameCarriesTheResponsesArea());
  });
});
