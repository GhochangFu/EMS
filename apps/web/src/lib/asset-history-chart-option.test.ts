import { describe, it } from "vitest";

import {
  aSecondUnitGetsASecondAxis,
  compareSeriesAreDashedAndShifted,
  noCompareMeansNoDashedSeries,
  oneUnitKeepsOneAxis,
  theSeriesTypeComesFromTheCatalog,
  theXAxisIsTheRequestedWindow,
} from "./asset-history-chart-option.spec";

/** Vitest entry point (ADR 0014). */
describe("F4.297 asset history chart option", () => {
  it("pins the x axis to the requested window", () => {
    theXAxisIsTheRequestedWindow();
  });
  it("draws compare series dashed and shifted by the span", () => {
    compareSeriesAreDashedAndShifted();
  });
  it("draws no compare series without a compare", () => {
    noCompareMeansNoDashedSeries();
  });
  it("reads the series type from the catalog", () => {
    theSeriesTypeComesFromTheCatalog();
  });
  it("gives a second unit a second axis", () => {
    aSecondUnitGetsASecondAxis();
  });
  it("keeps one axis for one unit", () => {
    oneUnitKeepsOneAxis();
  });
});
