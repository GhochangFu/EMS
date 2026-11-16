import { describe, it } from "vitest";

import {
  aLivePresetRefreshesAtTheForecastsPace,
  forecastAppliesToALiveAverage,
  namesAreSuffixedForMoreThanOnePoint,
  onePastTheAxisIsKeptAndTheRestDropped,
  theAxisMaxFollowsTheCap,
  theBandStacksAcrossSigns,
  theModelLabelMapsTheKnownNames,
  theP50IsDashedAndTheBandTooltipIsTheTrueRange,
  theBandsLegendEntryIsAShadedSwatch,
  theServerClockDecidesLiveness,
  thePastForecastAppliesBesideAvgOnAnyWindow,
  thePastForecastIsADashedLineThatBreaksAtAMissingHour,
  thePastForecastIsNamedAndCaptionedWithoutANumber,
  thePastWindowIsRoundedToWholeHours,
} from "./forecast-series.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.4a — the forecast series and the axis rule (ADR 0135 Amendment 3)", () => {
  it("the band stacks across signs: lower p10, upper p90 − p10, stackStrategy all", () => theBandStacksAcrossSigns());
  it("the p50 is dashed in the point's colour and the band tooltip is the true range", () =>
    theP50IsDashedAndTheBandTooltipIsTheTrueRange());
  it("names carry the point key for more than one point", () => namesAreSuffixedForMoreThanOnePoint());
  it("the axis max follows R8's cap", () => theAxisMaxFollowsTheCap());
  it("one bucket past the axis is kept and the rest dropped", () => onePastTheAxisIsKeptAndTheRestDropped());
  it("a forecast applies to a live average only (pre-fetch, browser clock)", () => forecastAppliesToALiveAverage());
  it("the server's asOf decides liveness after the fetch", () => theServerClockDecidesLiveness());
  it("the model label maps the known names and passes others through", () => theModelLabelMapsTheKnownNames());
  it("a live preset's reads refresh at the forecast's pace", () => aLivePresetRefreshesAtTheForecastsPace());
  it("the band's legend entry is a shaded swatch", () => theBandsLegendEntryIsAShadedSwatch());
});

describe("E1.4e — the past forecast line (ADR 0135 Amendment 4)", () => {
  it("is a dashed line in its colour that breaks at a missing hour", () =>
    thePastForecastIsADashedLineThatBreaksAtAMissingHour());
  it("is named by point and captioned without a number", () => thePastForecastIsNamedAndCaptionedWithoutANumber());
  it("applies beside avg on any window", () => thePastForecastAppliesBesideAvgOnAnyWindow());
  it("asks for a window rounded to whole hours", () => thePastWindowIsRoundedToWholeHours());
});
