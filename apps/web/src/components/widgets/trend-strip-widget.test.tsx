// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aFailedReadNeverRendersTheErrorMessage,
  aRangeClickReadsAgain,
  aSparklineLinksToTheHistoryPage,
  cleanupTrendStripWidget,
  noLocationDrawsTheSentenceAndReadsNothing,
  theFrameCarriesTheWidgetTitle,
  theGroupGoesToTheRead,
  thePreviewDrawsItsSentenceAndReadsNothing,
  theRangeStartsOnTheDefaultRange,
  theTwoSentencesDiffer,
} from "./trend-strip-widget.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.305 U4 TrendStripWidget", () => {
  afterEach(() => {
    cleanupTrendStripWidget();
  });

  it("carries the widget title on its frame and draws the strip inside", async () => {
    await theFrameCarriesTheWidgetTitle();
  });

  it("starts the range buttons and the first read on the config's default range", async () => {
    await theRangeStartsOnTheDefaultRange();
  });

  it("sends the widget's group as assetGroupId", async () => {
    await theGroupGoesToTheRead();
  });

  it("links a sparkline to /asset-history/:assetId?range=&points=", async () => {
    await aSparklineLinksToTheHistoryPage();
  });

  it("draws a fixed sentence and reads nothing on a dashboard with no location", async () => {
    await noLocationDrawsTheSentenceAndReadsNothing();
  });

  it("draws a fixed sentence for a failed read, never the error message", async () => {
    await aFailedReadNeverRendersTheErrorMessage();
  });

  it("reads again with the new range on a range click", async () => {
    await aRangeClickReadsAgain();
  });

  it("draws the static preview's sentence and reads nothing", () => {
    thePreviewDrawsItsSentenceAndReadsNothing();
  });

  it("keeps the no-site sentence apart from the preview sentence", () => {
    theTwoSentencesDiffer();
  });
});
