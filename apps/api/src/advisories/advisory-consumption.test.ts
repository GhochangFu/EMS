import { describe, it } from "vitest";

import {
  aLocationBaselineIsIgnored,
  anAssetBaselineFiresAtTheRatio,
  justUnderTheRatioIsNone,
  missingRateOrFactorDropsOnlyThatFigure,
  ownHistoryIsTheMedianOfFourWindows,
  shortOrZeroHistoryIsNone,
  theAnomalyCountsAreDistinctWindowHours,
  theContextChangesNoNumber,
  theFiguresUseTheAverageRateAndTheFactor,
  theTriggerIsTheEnergyPagesVerdict,
} from "./advisory-consumption.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.6a — consumption above baseline (ADR 0137, plan §4.3)", () => {
  it("an asset baseline of 1,000 kWh/day and 10,500 kWh fires at ratio 1.5, measured", () =>
    anAssetBaselineFiresAtTheRatio());
  it("10,499 kWh against 7,000 does not fire", () => justUnderTheRatioIsNone());
  it("a location-scope baseline row is ignored; own history decides (Q7)", () => aLocationBaselineIsIgnored());
  it("own history is the median of 4 windows", () => ownHistoryIsTheMedianOfFourWindows());
  it("2 counting windows or a zero baseline → none", () => shortOrZeroHistoryIsNone());
  it("the trigger equals verdictFor's on the same windows (Q4)", () => theTriggerIsTheEnergyPagesVerdict());
  it("money = excess × C ÷ E; CO₂ = excess × the factor", () => theFiguresUseTheAverageRateAndTheFactor());
  it("no rate → no money; no factor → no CO₂ and the assumption says so", () =>
    missingRateOrFactorDropsOnlyThatFigure());
  it("the context changes no number", () => theContextChangesNoNumber());
  it("unusual hours are distinct window hours at or above the line", () => theAnomalyCountsAreDistinctWindowHours());
});
