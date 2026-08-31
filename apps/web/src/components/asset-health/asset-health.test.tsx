// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  assetCardDistinguishesSkippedRulesFromNeverMatchedTags,
  assetCardRendersNullScoreAndZeroScoreDifferently,
  assetCardRendersUnconfiguredBandAlongsideTheRealScore,
  assetCardShowsGranularityAndCurrency,
  donutRendersEachBandsCountAndShare,
  donutRendersUnbandedAndUnscoredAsSeparateFigures,
  donutSaysWhyItHasNoSlices,
  donutShowsGranularityAndCurrency,
  donutWithBandsNeverSaysItHasNone,
} from "./asset-health.spec";

/**
 * `E1.3` Unit 8 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014), and the jsdom docblock is here because this is the file Vitest
 * collects (ADR 0042 decision 2).
 */
describe("E1.3 asset health surface", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a null score and a zero score as visibly different states", () => {
    assetCardRendersNullScoreAndZeroScoreDifferently();
  });

  it("renders an unconfigured band alongside the real score it belongs to", () => {
    assetCardRendersUnconfiguredBandAlongsideTheRealScore();
  });

  it("gives a skipped rule a different sentence from a tag no rule ever matched", () => {
    assetCardDistinguishesSkippedRulesFromNeverMatchedTags();
  });

  it("shows the asset card's own granularity and currency instant", () => {
    assetCardShowsGranularityAndCurrency();
  });

  it("renders the donut's unbanded and unscored counts as separate figures", () => {
    donutRendersUnbandedAndUnscoredAsSeparateFigures();
  });

  it("shows the donut's own granularity and currency instant", () => {
    donutShowsGranularityAndCurrency();
  });

  it("renders each band's count and its share of the total asset count", () => {
    donutRendersEachBandsCountAndShare();
  });

  it("says why it has no slices, instead of drawing an empty canvas", () => {
    donutSaysWhyItHasNoSlices();
  });

  it("never says it has no bands when it has them", () => {
    donutWithBandsNeverSaysItHasNone();
  });
});
