import { describe, it } from "vitest";

import {
  everyStackSeriesSharesTheStackIdAndTheCatalogType,
  noCompareTotalMeansNoDashedSeries,
  stackColoursCycleThePaletteUnlessAStackNamesOne,
  theCompareSeriesIsDashedUnstackedAndShiftedBySpan,
} from "./energy-stack-option.spec";

/** Vitest entry point (ADR 0014). */
describe("F4.299 energy stack option", () => {
  it("stacks every series under one id with the catalog type", () => {
    everyStackSeriesSharesTheStackIdAndTheCatalogType();
  });
  it("draws the compare total dashed, unstacked and shifted", () => {
    theCompareSeriesIsDashedUnstackedAndShiftedBySpan();
  });
  it("cycles the palette unless a stack names a colour", () => {
    stackColoursCycleThePaletteUnlessAStackNamesOne();
  });
  it("draws no dashed series without a compare total", () => {
    noCompareTotalMeansNoDashedSeries();
  });
});
