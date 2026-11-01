// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aFailedReadRendersAFixedSentence,
  aFailedRefetchKeepsTheSparklines,
  aGroupStripSendsItsGroupId,
  aLinkNamesTheAssetAndThePoint,
  aPendingReadShowsTheLoadingStatus,
  aStripTrimmedToOneAssetNamesThePointsCap,
  aStripWithADroppedSegmentSaysPointsAreHidden,
  aTrimmedStripSaysSo,
  aWholeSiteStripSendsANullGroup,
  anUntrimmedStripPrintsNoTrimLine,
  cleanupStrip,
  eachAssetPrintsItsLastValueWithItsUnit,
  moreAssetsLinksToTheAssetsTab,
  noMoreLinkWhenNoneBeyondTheCap,
  noSegmentsRendersTheEmptySentence,
  oneRowPerPointWithNameAndUnit,
  oneSectionPerSegmentWithItsLabel,
  pressing7dRefetchesAndMarksIt,
  sixSparklineLinksToTheHistoryPage,
  theLinksFollowTheSelectedRange,
  theSubtitleNamesTheListSource,
  theWindowLinePrintsTheResponseZone,
} from "./trend-strip.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.301 U4 TrendStrip", () => {
  afterEach(() => {
    cleanupStrip();
  });

  it("renders one section per segment, titled by the response label", async () => {
    await oneSectionPerSegmentWithItsLabel();
  });

  it("names the list source in each segment's subtitle", async () => {
    await theSubtitleNamesTheListSource();
  });

  it("renders one row per point with its name and catalog unit", async () => {
    await oneRowPerPointWithNameAndUnit();
  });

  it("renders six sparkline links to the history page", async () => {
    await sixSparklineLinksToTheHistoryPage();
  });

  it("names each link by asset code and point name", async () => {
    await aLinkNamesTheAssetAndThePoint();
  });

  it("prints each asset's last value with its own unit", async () => {
    await eachAssetPrintsItsLastValueWithItsUnit();
  });

  it("links +N more to the Assets & RTUs tab", async () => {
    await moreAssetsLinksToTheAssetsTab();
  });

  it("prints no +N more for a point within the cap", async () => {
    await noMoreLinkWhenNoneBeyondTheCap();
  });

  it("reads again with 7d and marks the button pressed", async () => {
    await pressing7dRefetchesAndMarksIt();
  });

  it("carries the selected range in the history links", async () => {
    await theLinksFollowTheSelectedRange();
  });

  it("renders the empty sentence for no segments", async () => {
    await noSegmentsRendersTheEmptySentence();
  });

  it("prints the trim line for a trimmed strip", async () => {
    await aTrimmedStripSaysSo();
  });

  it("names the points cap when the strip is trimmed to one asset per point", async () => {
    await aStripTrimmedToOneAssetNamesThePointsCap();
  });

  it("says some points are not shown when a trimmed segment has none", async () => {
    await aStripWithADroppedSegmentSaysPointsAreHidden();
  });

  it("prints no trim line for an untrimmed strip", async () => {
    await anUntrimmedStripPrintsNoTrimLine();
  });

  it("renders a fixed sentence and never the error message on a failed read", async () => {
    await aFailedReadRendersAFixedSentence();
  });

  it("keeps the sparklines and notes the failure when a refetch fails", async () => {
    await aFailedRefetchKeepsTheSparklines();
  });

  it("prints the response zone in the window line", async () => {
    await theWindowLinePrintsTheResponseZone();
  });

  it("sends a null group for a whole-site strip", async () => {
    await aWholeSiteStripSendsANullGroup();
  });

  it("sends the group id unchanged for a group tab", async () => {
    await aGroupStripSendsItsGroupId();
  });

  it("shows the loading status while the read is pending", async () => {
    await aPendingReadShowsTheLoadingStatus();
  });
});
