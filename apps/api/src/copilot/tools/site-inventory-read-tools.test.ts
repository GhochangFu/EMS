import { describe, it } from "vitest";

import * as spec from "./site-inventory-read-tools.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F4.288 — get_site_point_inventory", () => {
  it("a location outside the turn's organizations is refused and nothing is read", spec.aLocationOutsideTheTurnsOrganizationsIsRefusedAndNothingIsRead);
  it("a location outside the caller's grant is refused and nothing is read", spec.aLocationOutsideTheGrantIsRefusedAndNothingIsRead);
  it("domain reaches the service unchanged", spec.theDomainReachesTheService);
  it("the schema is strict and needs locationId", spec.theSchemaIsStrictAndNeedsALocation);
  it("a cursor of another organization is refused", spec.aForeignCursorIsRefused);
  it("a row joins its pair's statistics and its own rules", spec.aRowJoinsItsStatsAndItsOwnRules);
  it("statistics and rules are read for the page only", spec.statsAndRulesReadThePageOnly);
  it("a realistic site walks whole, under the cut, every pair once", spec.aRealisticSiteWalksWholeAndComplete);
  it("a realistic page holds at least 34 rows", spec.aRealisticPageHoldsAtLeast34Rows);
  it("a worst-case site walks whole, under the cut, every pair once", spec.aWorstCaseSiteWalksWholeAndComplete);
  it("assets with 255-character names still walk to the end, a row a page, every pair once", spec.longAssetNamesStillWalkToTheEnd);
  it("each page names only its own assets", spec.aPageNamesOnlyItsOwnAssets);
  it("a turn answers a site question from the tool", spec.theTurnAnswersASiteQuestionFromTheTool);
});
