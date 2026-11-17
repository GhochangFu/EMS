import { describe, it } from "vitest";

import {
  aDstWeekStillHasSevenDays,
  aLateUtcHourLandsInTheNextLocalDay,
  aNonFiniteHourIsLeftOut,
  coverageNeedsEightyPercentOfTheBuckets,
  theBaselineWindowsOverlapNothing,
  theWindowEndsAtTheMidnightJustPassed,
} from "./advisory-window.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.6a — the advisory window (ADR 0137, plan R-a, R-b)", () => {
  it("at 00:10 local the window ends at the midnight just passed; today's hours are out", () =>
    theWindowEndsAtTheMidnightJustPassed());
  it("an hour at 23:30 UTC lands in the next local day in Kolkata", () => aLateUtcHourLandsInTheNextLocalDay());
  it("134 buckets fail coverage, 135 pass", () => coverageNeedsEightyPercentOfTheBuckets());
  it("the four baseline windows overlap neither the window nor each other", () => theBaselineWindowsOverlapNothing());
  it("a DST-change week still gives 7 day labels", () => aDstWeekStillHasSevenDays());
  it("a non-finite hour adds nothing", () => aNonFiniteHourIsLeftOut());
});
