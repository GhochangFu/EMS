// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aGroupLessOrUnknownTabResolvesToNull,
  aLocationReadsOnce,
  aRangeClickReadsOnceMore,
  aTabKeySendsThatTabsGroup,
  cleanupTrendStripWidgetLive,
  noLocationReadsNothing,
  noTabKeySendsTheWholeSite,
} from "./trend-strip-widget-live.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.305 U4 TrendStripWidgetLive", () => {
  afterEach(() => {
    cleanupTrendStripWidgetLive();
  });

  it("sends the group of the tab its tabKey names", async () => {
    await aTabKeySendsThatTabsGroup();
  });

  it("sends a null group with no tabKey", async () => {
    await noTabKeySendsTheWholeSite();
  });

  it("resolves a group-less or unknown tab to the whole site", () => {
    aGroupLessOrUnknownTabResolvesToNull();
  });

  it("reads nothing on a dashboard with no location", async () => {
    await noLocationReadsNothing();
  });

  it("reads once on a dashboard with a location", async () => {
    await aLocationReadsOnce();
  });

  it("reads once more, with the same group, on a range click", async () => {
    await aRangeClickReadsOnceMore();
  });
});
