import { describe, it } from "vitest";

import {
  a2HasAtMostTwoLinesAndCountsTheRest,
  a3IsCutByTheEightLineBudget,
  a4IsBaselineOnlyOnlyWhenEveryHourIsBaselineAlone,
  fxaIsTwentyOneBaselineOnlyHoursOnSevenOfEighteen,
  fxbNamesTheBothMethodsAssetFirst,
  onlyNamedAssetsAreListedAndCardsAreByCode,
  pointsShowThreeAndTheLinkChartsAll,
  zeroUnusualHoursIsOneLine,
} from "./ml-findings.anomaly-facts.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9a — the anomaly facts (ADR 0135 Amendment 8 decision 2)", () => {
  it("FXA: A1 21 on 7 of 18, no A2, five A3 lines in order, the Baseline-only A4", () =>
    fxaIsTwentyOneBaselineOnlyHoursOnSevenOfEighteen());
  it("FXB: A1 6 on 4 of 19, A2 first naming RTU-H1, A3 without it, the mixed A4", () =>
    fxbNamesTheBothMethodsAssetFirst());
  it("A4 is the Baseline-only sentence only when every unusual hour is Baseline's alone (R-l)", () =>
    a4IsBaselineOnlyOnlyWhenEveryHourIsBaselineAlone());
  it("A2: at most two lines, the rest counted on the second", () => a2HasAtMostTwoLinesAndCountsTheRest());
  it("A3 is cut by the 8-line budget", () => a3IsCutByTheEightLineBudget());
  it("zero unusual hours is one line", () => zeroUnusualHoursIsOneLine());
  it("a line shows 3 points; the link charts all of them", () => pointsShowThreeAndTheLinkChartsAll());
  it("only named assets are listed; cards by code; organizations never mix; every card parses", () =>
    onlyNamedAssetsAreListedAndCardsAreByCode());
});
