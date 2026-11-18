import { describe, it } from "vitest";

import {
  aDstMonthStillHasEveryLabel,
  seriesOfDropsAMissingDayAndKeepsTheGap,
  theWindowEndsAtTheMidnightJustPassed,
  theWindowHasItsLabelsOldestFirst,
} from "./degradation-window.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.5a — the degradation window (ADR 0138, plan R-a, §4.2)", () => {
  it("at 00:10 local the window ends at the midnight just passed; today is not a label", () =>
    theWindowEndsAtTheMidnightJustPassed());
  it("28 labels, oldest first", () => theWindowHasItsLabelsOldestFirst());
  it("a DST-change month still gives 28 labels", () => aDstMonthStillHasEveryLabel());
  it("seriesOf drops a missing day and keeps the x gaps", () => seriesOfDropsAMissingDayAndKeepsTheGap());
});
