import "reflect-metadata";

import { describe, it } from "vitest";

import {
  aCursorOfAnotherOrganizationIsRefused,
  aCursorResumesWhereThePageStopped,
  aCursorThatDoesNotDecodeIsRefused,
  aFullRoomBetweenOrganizationsNamesTheNext,
  aLocationNotFoundIsRefusedBeforeAnyRead,
  aLocationOutsideTheGrantIsRefused,
  aLocationReadsItsOrganizationWithTheSubtreeIds,
  aNamedOrganizationBoundsTheLocation,
  anEmptySubtreeIsListedEmptyAndUnread,
  anOffsetToolRefusesAStringKey,
  anUnpagedToolReturnsNoNextCursor,
  aPagedLoopStopsAtTheFirstCutOrganization,
  listAlarmsPassesTheServiceCursorThrough,
  listAlarmsRefusesAMangledServiceCursor,
  listAlarmsRefusesAnAssetAndALocationTogether,
  listAlarmsWithALocationReadsTheSubtree,
  listAssetsPageTwoStartsAtThe26thMatch,
  listAssetsWithALocationReadsTheSubtree,
  listLocationsPagesByCursor,
  listLocationsSearchFindsASitePastTheCap,
} from "./list-scope-read-tools.spec";

/** `F4.291` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); one `it()` per claim. */
describe("F4.291 — a copilot list takes a location and an opaque cursor", () => {
  it("a location reads only its organization, with exactly the subtree's readable ids", aLocationReadsItsOrganizationWithTheSubtreeIds);
  it("a location not found is refused before any read", aLocationNotFoundIsRefusedBeforeAnyRead);
  it("a location outside the caller's grant is refused with its own sentence", aLocationOutsideTheGrantIsRefused);
  it("a named organization is the location's only candidate", aNamedOrganizationBoundsTheLocation);
  it("an empty subtree lists the organization empty and calls no service", anEmptySubtreeIsListedEmptyAndUnread);
  it("a cursor resumes where the page stopped and ends with null", aCursorResumesWhereThePageStopped);
  it("a room filled between organizations names the next one", aFullRoomBetweenOrganizationsNamesTheNext);
  it("a paged loop stops at the first cut organization", aPagedLoopStopsAtTheFirstCutOrganization);
  it("a cursor that does not decode is refused", aCursorThatDoesNotDecodeIsRefused);
  it("an offset tool refuses a string key", anOffsetToolRefusesAStringKey);
  it("a cursor of an organization the call does not read is refused", aCursorOfAnotherOrganizationIsRefused);
  it("a tool without paging returns no nextCursor", anUnpagedToolReturnsNoNextCursor);
  it("list_assets with a location reads the subtree ids only", listAssetsWithALocationReadsTheSubtree);
  it("list_assets page 2 starts at the 26th match", listAssetsPageTwoStartsAtThe26thMatch);
  it("list_alarms with a location reads the subtree ids", listAlarmsWithALocationReadsTheSubtree);
  it("list_alarms hands the service's keyset cursor back to the service", listAlarmsPassesTheServiceCursorThrough);
  it("list_alarms refuses a cursor whose key the service did not encode", listAlarmsRefusesAMangledServiceCursor);
  it("list_alarms refuses assetId and locationId together before dispatch", listAlarmsRefusesAnAssetAndALocationTogether);
  it("list_locations search finds a site past the 25th node", listLocationsSearchFindsASitePastTheCap);
  it("list_locations pages by cursor", listLocationsPagesByCursor);
});
