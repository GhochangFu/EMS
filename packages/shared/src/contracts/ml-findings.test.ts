import { describe, it } from "vitest";

import {
  runAnomalyHrefTest,
  runAssetRefBoundsTest,
  runCardKeysTest,
  runConstantsTest,
  runFactBoundsTest,
  runForecastHrefTest,
  runFullSummaryParsesTest,
  runLongLabelTest,
  runNotStrictTest,
  runParagraphAssetsTest,
  runParagraphStateTest,
} from "./ml-findings.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9a — the ML findings contracts (ADR 0135 Amendment 8)", () => {
  it("the kinds, fact ids, caps and paragraph states", () => runConstantsTest());
  it("a full summary parses; 8 facts parse", () => runFullSummaryParsesTest());
  it("9 facts, no facts, an unknown fact id F9 and a fact with no segment are refused", () => runFactBoundsTest());
  it("an asset reference B1, A0, A, A1000 or a1 is refused, in the asset list and in a segment", () =>
    runAssetRefBoundsTest());
  it("the longest asset label (322 characters) parses; 331 is refused", () => runLongLabelTest());
  it("a paragraph state error and a segment over 600 characters are refused", () => runParagraphStateTest());
  it("E1.9d a paragraph card carries its own assets, and one without is refused", () => runParagraphAssetsTest());
  it("an unknown extra key parses (responses are not strict)", () => runNotStrictTest());
  it("the card's key set is exactly the five keys: no facts hash", () => runCardKeysTest());
  it("forecastFindingHref: one key is the Forecasts table's link; two keys join with a comma", () =>
    runForecastHrefTest());
  it("anomalyFindingHref: t − 24 h to min(t + 24 h, asOf), the points, no range key", () => runAnomalyHrefTest());
});
