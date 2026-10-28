import "reflect-metadata";

import { describe, it } from "vitest";

import {
  aGlobalAdminIsNeverOutsideTheGrant,
  aLocationOutsideTheCandidatesIsNotFound,
  aLocationOutsideTheGrantIsRefused,
  aNonEmptyAnswerReadsNoLocationGrant,
  anEmptyReadableSetMakesNoAssetStatement,
  anEmptySiteInsideTheGrantIsAnEmptyAnswer,
  aGrantBelowTheAskedLocationIsAnEmptyAnswer,
  locationsInTwoOrganizationsAreRefused,
  noLocationOrNoCandidateIsNotFoundWithoutAStatement,
  thePlacementIsBoundToTheCandidateOrganizations,
  theAssetStatementIntersectsTheSubtreeAndTheReadableIds,
  theReadableIdsAreAskedForTheLocationsOrganization,
  theSubtreeWalkIsBoundToThePlacedOrganization,
} from "./location-asset-scope.service.spec";

/** `F4.291` — Vitest entry point for `LocationAssetScopeService`. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.291 — a location to the caller's readable assets of its subtree", () => {
  it("binds the placement to the candidate organizations", thePlacementIsBoundToTheCandidateOrganizations);
  it("answers not_found for a location outside the candidates, with no scope read", aLocationOutsideTheCandidatesIsNotFound);
  it("answers not_found for no location or no candidate without a statement", noLocationOrNoCandidateIsNotFoundWithoutAStatement);
  it("refuses locations in two organizations before any walk", locationsInTwoOrganizationsAreRefused);
  it("asks the readable ids of the location's own organization", theReadableIdsAreAskedForTheLocationsOrganization);
  it("bounds the subtree walk to the placed organization", theSubtreeWalkIsBoundToThePlacedOrganization);
  it("intersects the subtree with the readable ids in the asset statement", theAssetStatementIntersectsTheSubtreeAndTheReadableIds);
  it("makes no asset statement for a caller with no readable asset", anEmptyReadableSetMakesNoAssetStatement);
  it("refuses a location outside the caller's grant", aLocationOutsideTheGrantIsRefused);
  it("answers an empty site inside the grant with no asset ids", anEmptySiteInsideTheGrantIsAnEmptyAnswer);
  it("answers an empty list when the grant lies below the asked location", aGrantBelowTheAskedLocationIsAnEmptyAnswer);
  it("never refuses a found location for the global admin", aGlobalAdminIsNeverOutsideTheGrant);
  it("reads no location grant on a non-empty answer", aNonEmptyAnswerReadsNoLocationGrant);
});
