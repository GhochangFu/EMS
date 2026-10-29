import { describe, it } from "vitest";

import {
  aMissingOrDoubleRangeIsRefused,
  aRangeOverThirtyOneDaysIsRefused,
  aReversedRangeIsRefused,
  aSeededEstateIsOneCall,
  aSiteNotFoundIsRefusedAndNothingIsRead,
  aSiteOutsideTheReadableLocationsIsRefused,
  aWorstCasePageHoldsTheMeasuredRowsAndTheWalkIsWhole,
  lastDaysIsWholeDaysEndingOnTheTurnsDate,
  namedSitesArePlacedByTheLocationHelper,
  sitesHoldingNoReadableAssetAreRefused,
  theCallersReadableIdsAndLocationsReachTheService,
  twoOrganizationsAreWalkedWhole,
} from "./location-summary-read-tools.spec";

/** `F4.290` PR 2 — Vitest entry point; the assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.290 — get_location_summary", () => {
  it("refuses a range over 31 days before any call", aRangeOverThirtyOneDaysIsRefused);
  it("refuses a reversed range", aReversedRangeIsRefused);
  it("refuses no range and lastDays beside a date", aMissingOrDoubleRangeIsRefused);
  it("reads lastDays as whole UTC days ending on the turn's date", lastDaysIsWholeDaysEndingOnTheTurnsDate);
  it("passes the caller's readable ids and locations, and asks no location helper without locationIds", theCallersReadableIdsAndLocationsReachTheService);
  it("places named sites with the location helper", namedSitesArePlacedByTheLocationHelper);
  it("refuses a site not found and summarises nothing", aSiteNotFoundIsRefusedAndNothingIsRead);
  it("refuses sites holding no readable asset", sitesHoldingNoReadableAssetAreRefused);
  it("refuses a named site outside the caller's readable locations", aSiteOutsideTheReadableLocationsIsRefused);
  it("answers a seeded estate of 13 sites in one call", aSeededEstateIsOneCall);
  it("holds the measured worst-case rows per page and walks every row once", aWorstCasePageHoldsTheMeasuredRowsAndTheWalkIsWhole);
  it("walks two organizations whole", twoOrganizationsAreWalkedWhole);
});
