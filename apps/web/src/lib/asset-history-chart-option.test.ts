import { describe, it } from "vitest";

import {
  aForecastAddsThreeSeriesTheLegendAndTheNowLine,
  aPastWindowDrawsNoForecast,
  aRefusedThirdUnitGetsNoForecast,
  aShortWindowClipsTheForecast,
  aSecondUnitGetsASecondAxis,
  compareSeriesAreDashedAndShifted,
  noCompareMeansNoDashedSeries,
  noForecastKeepsTheWindowAndDrawsNoNowLine,
  oneUnitKeepsOneAxis,
  theSeriesTypeComesFromTheCatalog,
  theXAxisIsTheRequestedWindow,
  twoForecastsAreNamedByPoint,
  aPastForecastIsADashedLineInAColourNoActualLineUses,
  aPastWindowStillDrawsThePastForecast,
  noPastForecastAddsNothing,
  pastColoursNeverMatchAnActualColour,
  twoPastForecastsAreNamedByPointInTheirOwnColours,
  eachForecastIsTracedToItsPointInTheLegend,
  forecastColoursNeverMatchActualOrPastWithSeveralPoints,
  onePointDrawsActualPastAndFutureInThreeColours,
  theTooltipDropsFloatNoiseAndKeepsRealDigits,
  theTooltipPrintsNoiseAroundZeroAsZero,
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
  it("E1.4a a forecast adds three series, the legend and the now line, and moves the axis past to", () => {
    aForecastAddsThreeSeriesTheLegendAndTheNowLine();
  });
  it("E1.4a no forecast keeps the window and draws no now line", () => {
    noForecastKeepsTheWindowAndDrawsNoNowLine();
  });
  it("E1.4a a window that ended over an hour before asOf draws no forecast", () => {
    aPastWindowDrawsNoForecast();
  });
  it("E1.4a a point refused a third axis gets no forecast", () => {
    aRefusedThirdUnitGetsNoForecast();
  });
  it("E1.4a two forecasts are named by point", () => {
    twoForecastsAreNamedByPoint();
  });
  it("E1.4a a short window clips the forecast to the axis plus one bucket", () => {
    aShortWindowClipsTheForecast();
  });
  it("E1.4e a past forecast is a dashed line in a colour no actual line uses", () => {
    aPastForecastIsADashedLineInAColourNoActualLineUses();
  });
  it("E1.4e a past window still draws the past forecast", () => {
    aPastWindowStillDrawsThePastForecast();
  });
  it("E1.4e two past forecasts are named by point in their own colours", () => {
    twoPastForecastsAreNamedByPointInTheirOwnColours();
  });
  it("E1.4e no past forecast adds nothing", () => {
    noPastForecastAddsNothing();
  });
  it("E1.4e past colours never match an actual colour", () => {
    pastColoursNeverMatchAnActualColour();
  });
  it("F4.377 one point draws actual, past forecast and live forecast in three colours", () => {
    onePointDrawsActualPastAndFutureInThreeColours();
  });
  it("F4.377 with several points no forecast colour matches an actual or a past colour", () => {
    forecastColoursNeverMatchActualOrPastWithSeveralPoints();
  });
  it("F4.377 each forecast is traced to its point in the legend", () => {
    eachForecastIsTracedToItsPointInTheLegend();
  });
  it("F4.379 the tooltip drops float noise and keeps real digits", () => {
    theTooltipDropsFloatNoiseAndKeepsRealDigits();
  });
  it("F4.382 the tooltip prints float noise around zero as 0", () => {
    theTooltipPrintsNoiseAroundZeroAsZero();
  });
});
