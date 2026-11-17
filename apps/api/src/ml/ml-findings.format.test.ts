import { describe, it } from "vitest";

import {
  aCelsiusPointSaysColdestAndWarmest,
  aSignedChangeCarriesItsSign,
  aTimeIsDayMonthAndHourInTheSitesZone,
  aValueHasAtMostTwoDecimalsNoGroupingAndItsUnit,
  anUnknownZoneFallsBackToUtc,
} from "./ml-findings.format.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9a — the findings' words and formats (ADR 0135 Amendment 8)", () => {
  it("a value: at most 2 decimals, no grouping, ASCII minus, then the unit", () =>
    aValueHasAtMostTwoDecimalsNoGroupingAndItsUnit());
  it("a signed change carries + or -", () => aSignedChangeCarriesItsSign());
  it("a time is `17 Nov 14:05` in the site's zone", () => aTimeIsDayMonthAndHourInTheSitesZone());
  it("an unknown zone falls back to UTC", () => anUnknownZoneFallsBackToUtc());
  it("a °C point says coldest/warmest, any other lowest/highest", () => aCelsiusPointSaysColdestAndWarmest());
});
