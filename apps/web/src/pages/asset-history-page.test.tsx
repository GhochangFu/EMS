// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";

import {
  aCustomRangeInTheUrlIsSentAsThePair,
  aFilledPreviousPeriodDoesNotSaySo,
  aForbiddenAssetRendersTheAccessSentence,
  aNinthPointIsRefused,
  aPresetAndCompareInTheUrlReachTheRead,
  anEmptyPreviousPeriodSaysSo,
  eachPointShowsItsLatestValueAndPollTime,
  loadOlderPagesWithTheCursor,
  theFirstPointIsChartedByDefault,
  theHeaderShowsCodeAndName,
  theLevelIsTheResponsesBucketWidth,
  timesAreInTheSiteZone,
} from "./asset-history-page.spec";

vi.mock("echarts-for-react", () => ({
  default: () => null,
}));

/**
 * Vitest entry point (ADR 0014, ADR 0042 decision 2) — assertions live in the sibling `.spec`.
 * `TZ` is pinned to a zone no fixture uses, so a time formatted in the browser's zone fails.
 */
beforeAll(() => {
  vi.stubEnv("TZ", "America/St_Johns");
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("F4.297 asset history page", () => {
  it("names the asset by code and name", async () => {
    await theHeaderShowsCodeAndName();
  });

  it("lists each point with its latest value and poll time", async () => {
    await eachPointShowsItsLatestValueAndPollTime();
  });

  it("charts the first point by default with one aggregate read that asks for bucket stats", async () => {
    await theFirstPointIsChartedByDefault();
  });

  it("refuses a 9th point with the sentence", async () => {
    await aNinthPointIsRefused();
  });

  it("sends a preset and compare from the URL as a trailing window", async () => {
    await aPresetAndCompareInTheUrlReachTheRead();
  });

  it("sends a custom range from the URL as from/to with no windowMinutes", async () => {
    await aCustomRangeInTheUrlIsSentAsThePair();
  });

  it("renders the access sentence and no chart on a 403", async () => {
    await aForbiddenAssetRendersTheAccessSentence();
  });

  it("prints the level the response reported", async () => {
    await theLevelIsTheResponsesBucketWidth();
  });

  it("says 'no data for the previous period' when every compare bucket is empty", async () => {
    await anEmptyPreviousPeriodSaysSo();
  });

  it("does not say so when the previous period has a value", async () => {
    await aFilledPreviousPeriodDoesNotSaySo();
  });

  it("loads older records with before = nextBefore", async () => {
    await loadOlderPagesWithTheCursor();
  });

  it("formats raw and poll times in the site zone and names it", async () => {
    await timesAreInTheSiteZone();
  });
});
