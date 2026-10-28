import { describe, it } from "vitest";

import {
  anOrganizationOutsideTheAllowedSetIsRefused,
  anOrganizationWithNoReadableAssetIsNotRead,
  assetIdNarrows,
  fortyRowsAreCutToTwentyFive,
  includeInactiveReturnsAnInactiveRow,
  listIsCalledPerOrganizationWithItsAssetsAndNoWindow,
  searchIsPassedToTheServiceAsTitleSearch,
  searchNarrowsBeforeTheCap,
  theProjectionKeepsWhatAProposalNeeds,
  withoutTheFlagAnInactiveRowIsNotListed,
  locationIdNarrowsToTheSubtree,
  aCursorResumesAtTheOffset,
} from "./maintenance-read-tools.spec";

/** `F4.281` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.281 — list_maintenance_schedules (ADR 0099 Amendment 8 D7, owner ruling DC4)", () => {
  it("calls list once per organization with its readable assets and no due-date window", () =>
    listIsCalledPerOrganizationWithItsAssetsAndNoWindow());
  it("does not read an organization with no readable asset", () => anOrganizationWithNoReadableAssetIsNotRead());
  it("includeInactive returns a deactivated schedule with active false", () => includeInactiveReturnsAnInactiveRow());
  it("without the flag an inactive schedule is not listed", () => withoutTheFlagAnInactiveRowIsNotListed());
  it("passes search to the service as titleSearch", () => searchIsPassedToTheServiceAsTitleSearch());
  it("search narrows before the service's row cap", () => searchNarrowsBeforeTheCap());
  it("assetId narrows", () => assetIdNarrows());
  it("cuts 40 rows to 25 with truncated", () => fortyRowsAreCutToTwentyFive());
  it("refuses an organization outside the allowed set without a read", () => anOrganizationOutsideTheAllowedSetIsRefused());
  it("keeps what a proposal needs and drops the free text", () => theProjectionKeepsWhatAProposalNeeds());
  it("F4.291: locationId narrows to the subtree's readable assets", () => locationIdNarrowsToTheSubtree());
  it("F4.291: a cursor resumes at the offset", () => aCursorResumesAtTheOffset());
});
