import { describe, it } from "vitest";

import {
  aCellTheApiDidNotWriteIsNeverDrawn,
  aNullDayDrawsNoBar,
  choosingTheKindBindsTheCostSourceAndDropsThePoints,
  theBuilderAcceptsADailyCostChart,
  theChartOpensOnThirtyDaysOrTheBound,
  theCostTileSaysDaysAndWhy,
  theDaysAreClampedToOneToNinety,
  theStoredCostPointsAreFoundByKey,
  theSwitchOffersTheWindowsTheBoundDaysHold,
  theTotalIsTheSumOfTheBarsShown,
  theWindowIsTheLastDays,
} from "./cost-by-day-chart.spec";

/** `F4.332` — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.332 — the daily energy cost chart's pure halves", () => {
  it("offers the windows the bound days hold", () => theSwitchOffersTheWindowsTheBoundDaysHold());
  it("opens on 30 days, or the bound", () => theChartOpensOnThirtyDaysOrTheBound());
  it("shows the last days of the window", () => theWindowIsTheLastDays());
  it("totals the bars shown and counts the priced days", () => theTotalIsTheSumOfTheBarsShown());
  it("never draws a cell the API did not write", () => aCellTheApiDidNotWriteIsNeverDrawn());
  it("draws no bar for a null day", () => aNullDayDrawsNoBar());
  it("binds the cost source when the kind is chosen, and drops it after", () => choosingTheKindBindsTheCostSourceAndDropsThePoints());
  it("writes only a days read from 1 to 90", () => theDaysAreClampedToOneToNinety());
  it("passes a daily cost chart through the builder's Save gate", () => theBuilderAcceptsADailyCostChart());
  it("finds the stored cost points by key", () => theStoredCostPointsAreFoundByKey());
  it("says days and why on the cost tile", () => theCostTileSaysDaysAndWhy());
});
