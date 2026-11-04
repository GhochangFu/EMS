import { describe, it } from "vitest";

import {
  aRowHasBegunAtItsOwnStart,
  aRowHasEndedAtItsOwnEnd,
  anUncoveredInstantIsUndefined,
  theNearestScopeWinsInsideItsWindow,
  theNextScopeServesBeforeTheNearestStarts,
} from "./calc-parameter-series.spec";

/** `F4.311` task 5.4 — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.311 — parameterValueAt", () => {
  it("serves the nearest scope inside its window", theNearestScopeWinsInsideItsWindow);
  it("serves the next scope before the nearest starts", theNextScopeServesBeforeTheNearestStarts);
  it("treats a row as ended at its own end (half-open)", aRowHasEndedAtItsOwnEnd);
  it("treats a row as begun at its own start", aRowHasBegunAtItsOwnStart);
  it("answers undefined for an instant no row covers", anUncoveredInstantIsUndefined);
});
