import { describe, it } from "vitest";

import {
  mannKendallGivesTheRow,
  normalCdfHasItsKnownValues,
  oneValueOrAllEqualGivesNoTrend,
  theilSenGivesTheRow,
  VECTOR_IDS,
  z90IsTheNinetyFivePercentQuantile,
} from "./trend-math.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.5a — Mann–Kendall and Theil–Sen (ADR 0138, plan §4.3)", () => {
  it.each(VECTOR_IDS)("%s: Mann–Kendall S, Var(S), Z and p", (id) => mannKendallGivesTheRow(id));
  it.each(VECTOR_IDS)("%s: Theil–Sen slope and Sen's interval", (id) => theilSenGivesTheRow(id));
  it("Z_90 is the 0.95 normal quantile", () => z90IsTheNinetyFivePercentQuantile());
  it("normalCdf: Φ(0) = 0.5, Φ(1.959964) ≈ 0.975, symmetry", () => normalCdfHasItsKnownValues());
  it("one value or all-equal values give z 0, p 1", () => oneValueOrAllEqualGivesNoTrend());
});
