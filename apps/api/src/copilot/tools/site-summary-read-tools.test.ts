import { describe, it } from "vitest";

import * as spec from "./site-summary-read-tools.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F4.296 — a site-wide read inside one turn", () => {
  it("a summary reads the whole site in one call", spec.aSummaryReadsTheWholeSiteInOneCall);
  it("a summary names the 5 highest and 5 lowest assets by mean", spec.aSummaryNamesTheHighestAndLowestAssets);
  it("a small site names each asset once", spec.aSmallSiteNamesEachAssetOnce);
  it("a summary names the assets with no data, at most 10", spec.aSummaryNamesTheAssetsWithNoData);
  it("a summary drops a row not asked", spec.aSummaryDropsARowNotAsked);
  it("a summary has the shared fields at the top and no items", spec.aSummaryHasTheSharedFieldsAtTheTop);
  it("a 52-asset summary reaches the model whole", spec.aFiftyTwoAssetSummaryReachesTheModelWhole);
  it("summary with assetIds is refused", spec.aSummaryWithAssetIdsIsRefused);
  it("summary with a cursor is refused", spec.aSummaryWithACursorIsRefused);
  it("a location page reports its asset count", spec.aLocationPageReportsTheAssetCount);
  it("unruled lists only the unwatched points, with the counts", spec.unruledListsOnlyTheUnwatchedPoints);
  it("unruled reads the rules once and units for the page, no statistics", spec.unruledReadsTheRulesOnceAndUnitsForThePage);
  it("unruled resumes after the last kept point", spec.unruledResumesAfterTheLastKeptPoint);
  it("unruled keeps a point with no unit", spec.unruledKeepsAPointWithNoUnit);
  it("a 207-point unruled read fits in at most two pages", spec.aTwoHundredPointUnruledReadFitsInTwoPages);
  it("an open page appends the partial sentence", spec.anOpenPageAppendsThePartialSentence);
  it("a final page closes the read", spec.aFinalPageClosesTheRead);
  it("a resumed read adds its rows", spec.aResumedReadAddsItsRows);
  it("a first page starts the count again", spec.aFirstPageStartsTheCountAgain);
  it("another site's closed read keeps the first open", spec.anotherSitesClosedReadKeepsTheFirstOpen);
  it("a summary closes the open location read", spec.aSummaryClosesTheOpenLocationRead);
  it("a cursor sent twice counts once", spec.aCursorSentTwiceCountsOnce);
  it("an unpaged result is not noted", spec.anUnpagedResultIsNotNoted);
  it("a turn that left a page unread says so", spec.aTurnThatLeftAPageUnreadSaysSo);
  it("the system prompt names both modes", spec.theSystemPromptNamesBothModes);
});
