// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import {
  aFailedReadShowsTheErrorLine,
  aTelemetryReadingFlipsABreakerRowWithoutARefetch,
  onlyTheBreakerTableOpensATelemetrySocket,
  aFailedRefetchKeepsTheLastDrawing,
  aWidgetOnAStoredOverviewTabReadsWithItsKey,
  aLegendReadsNothingButStillDrawsOnTheOverview,
  anAlarmEventRefetchesTheRead,
  aCanvasWithNoReadingSiteWidgetOpensNoAlarmsSocket,
  oneAlarmEventRefetchesEachTabOnce,
  oneAlarmsSocketPerCanvas,
  aWidgetOnNoTabReadsWithANullTabKey,
  cleanupLive,
  oneReadPerTabWithTheCanvasDerivedTabKey,
  theCardLinksUnderTheRoutesSite,
  onTheSiteRouteTheCardLinkKeepsTheQuery,
  inTheViewerTheCardLinksToTheTabParam,
  withNoSiteAndNoViewerTheCardIsNotALink,
  theFrameShowsLoadingUntilTheFirstAnswer,
  theReadPollsEveryFifteenSeconds,
} from "./site-widget-live.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.73 SiteWidgetLive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupLive();
    vi.restoreAllMocks();
  });

  it("SL1 one read per tab, with the tab key the canvas derives from the widget's tab", async () => {
    await oneReadPerTabWithTheCanvasDerivedTabKey();
  });
  it("SL2 a widget on no tab reads with a null tab key", async () => {
    await aWidgetOnNoTabReadsWithANullTabKey();
  });
  it("SL3 the legend draws from the vocabulary alone", async () => {
    await aLegendReadsNothingButStillDrawsOnTheOverview();
  });
  it("SL4 a failed read shows the error line", async () => {
    await aFailedReadShowsTheErrorLine();
  });
  it("SL5 the frame shows loading until the first answer", async () => {
    await theFrameShowsLoadingUntilTheFirstAnswer();
  });
  it("SL6 the card links under the route's own site", async () => {
    await theCardLinksUnderTheRoutesSite();
  });
  it("SL6d on the site route the card's link keeps the query (F3.77 review fix)", async () => {
    await onTheSiteRouteTheCardLinkKeepsTheQuery();
  });
  it("SL6b in the viewer the card links to its ?tab= (critique fix)", async () => {
    await inTheViewerTheCardLinksToTheTabParam();
  });
  it("SL6c with no site and no viewer the card is not a link", async () => {
    await withNoSiteAndNoViewerTheCardIsNotALink();
  });
  it("SL7 an alarm event refetches the read", async () => {
    await anAlarmEventRefetchesTheRead();
  });
  it("SL8 the read polls every 15 s", async () => {
    await theReadPollsEveryFifteenSeconds();
  });
  it("SL9 a failed refetch keeps the last good drawing", async () => {
    await aFailedRefetchKeepsTheLastDrawing();
  });
  it("SL10 a widget on a stored Overview tab reads with its key, not null", async () => {
    await aWidgetOnAStoredOverviewTabReadsWithItsKey();
  });
  it("SL11 one /ws/alarms socket per canvas, however many site widgets read", async () => {
    await oneAlarmsSocketPerCanvas();
  });
  it("SL12 one alarm event refetches each tab's read once", async () => {
    await oneAlarmEventRefetchesEachTabOnce();
  });
  it("SL13 a canvas with no reading site widget opens no /ws/alarms socket", async () => {
    await aCanvasWithNoReadingSiteWidgetOpensNoAlarmsSocket();
  });
  it("SL14 a telemetry reading flips a breaker row without a refetch (F3.74)", async () => {
    await aTelemetryReadingFlipsABreakerRowWithoutARefetch();
  });
  it("SL15 only the breaker table opens a /ws/telemetry socket (F3.74)", async () => {
    await onlyTheBreakerTableOpensATelemetrySocket();
  });
});
