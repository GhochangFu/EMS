import { describe, it } from "vitest";

import {
  aFlatRangeStillHasFiveBands,
  emptyCellsAreEveryGridSlotWithoutAValue,
  fiveBandsCoverEveryValueAndEndOnTheHue,
  theLegendIsSteppedAndTheEmptyTilesUseWell,
  tilesHaveAGapInTheCardColour,
} from "./heatmap-style.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("heatmap style — stepped bands on gapped tiles", () => {
  it("five bands cover every value and end on the hue", () => fiveBandsCoverEveryValueAndEndOnTheHue());
  it("a flat range still has five bands", () => aFlatRangeStillHasFiveBands());
  it("the legend is stepped and empty tiles use `well`", () => theLegendIsSteppedAndTheEmptyTilesUseWell());
  it("tiles have a gap in the card colour", () => tilesHaveAGapInTheCardColour());
  it("empty cells are every grid slot without a value", () => emptyCellsAreEveryGridSlotWithoutAValue());
});
