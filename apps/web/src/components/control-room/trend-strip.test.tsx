// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aColoredPointStrokesWithItsRole,
  aFailedReadRendersAFixedSentence,
  aFailedRefetchKeepsTheSparklines,
  aGroupStripSendsItsGroupId,
  aLinkNamesTheAssetAndThePoint,
  anRtuLessLinkNamesTheLocation,
  theTilePrintsTheAssetLabel,
  theTileLabelIsNeverTruncated,
  aPendingReadShowsTheLoadingStatus,
  aStripTrimmedToOneAssetNamesThePointsCap,
  aStripWithADroppedSegmentSaysPointsAreHidden,
  aTrimmedStripSaysSo,
  aWholeSiteStripSendsANullGroup,
  anUncoloredPointKeepsAccent,
  anUntrimmedStripPrintsNoTrimLine,
  cleanupStrip,
  eachAssetPrintsItsLastValueWithItsUnit,
  exportDownloadsTheCurrentQuery,
  moreAssetsLinksToTheAssetsTab,
  noMoreLinkWhenNoneBeyondTheCap,
  noSegmentsRendersTheEmptySentence,
  noSelectionSendsNoSelectionKeys,
  noSelectionStrokesEveryPolylineAccent,
  oneRowPerPointWithNameAndUnit,
  oneSectionPerSegmentWithItsLabel,
  pressing7dRefetchesAndMarksIt,
  sixSparklineLinksToTheHistoryPage,
  theLinksFollowTheSelectedRange,
  theFixedMountOffersExport,
  theStripHasNoPin,
  theStripHasNoSchedule,
  theSubtitleNamesTheListSource,
  theWallDrawsNoExport,
  theReadCarriesTheSelection,
  theWindowLinePrintsTheResponseZone,
  twoSelectionsAreTwoReads,
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

  it("names each link by asset label and point name", async () => {
    await aLinkNamesTheAssetAndThePoint();
  });

  it("names an RTU-less asset's link by its location (F4.316)", async () => {
    await anRtuLessLinkNamesTheLocation();
  });

  it("prints the asset label under each sparkline (F4.316)", async () => {
    await theTilePrintsTheAssetLabel();
  });

  it("never truncates the tile's asset label (F4.316)", async () => {
    await theTileLabelIsNeverTruncated();
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

  it("F4.303: the fixed mount offers the Export group", async () => {
    await theFixedMountOffersExport();
  });

  it("F4.303: Export downloads the strip's current range and group", async () => {
    await exportDownloadsTheCurrentQuery();
  });

  it("F4.303: the wall draws no Export group", async () => {
    await theWallDrawsNoExport();
  });

  it("F4.303 U15: the strip has no Pin", async () => {
    await theStripHasNoPin();
  });

  it("F4.303 U16: the strip has no Schedule", async () => {
    await theStripHasNoSchedule();
  });
});

describe("F4.306 U9 TrendStripBody selection", () => {
  afterEach(() => {
    cleanupStrip();
  });

  it("strokes a coloured point's polylines with its role", async () => {
    await aColoredPointStrokesWithItsRole();
  });

  it("keeps accent on a point with no colour", async () => {
    await anUncoloredPointKeepsAccent();
  });

  it("strokes every polyline accent with no selection", async () => {
    await noSelectionStrokesEveryPolylineAccent();
  });

  it("sends the selection's segments and points", async () => {
    await theReadCarriesTheSelection();
  });

  it("sends only range and group with no selection", async () => {
    await noSelectionSendsNoSelectionKeys();
  });

  it("reads twice for two selections in one query client", async () => {
    await twoSelectionsAreTwoReads();
  });
});
