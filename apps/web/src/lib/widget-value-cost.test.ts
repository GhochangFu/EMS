import { describe, it } from "vitest";

import {
  aCostTotalTileCountsDays,
  aNullCostTotalTileSaysWhy,
  aStoredCostTileSaysTheRateIsToday,
  anotherTileHasNoCostNote,
} from "./widget-value-cost.spec";

/** `F4.332` — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.332 — the energy cost tile notes", () => {
  it("counts days on an energy.cost.total tile", () => aCostTotalTileCountsDays());
  it("says why an energy.cost.total tile is null", () => aNullCostTotalTileSaysWhy());
  it("says a stored cost point is at the rate effective now", () => aStoredCostTileSaysTheRateIsToday());
  it("adds no note to another tile", () => anotherTileHasNoCostNote());
});
