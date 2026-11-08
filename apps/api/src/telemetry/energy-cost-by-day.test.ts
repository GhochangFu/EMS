import { describe, it } from "vitest";

import {
  assertADayWithNoBucketIsNoEnergy,
  assertAMidDayRateChangeSplitsTheDay,
  assertAMissingRateIsNullWithTheReason,
  assertANoPricedDayTotalIsNullWithTheReason,
  assertAnEditedOldRateRepricesOnlyItsDays,
  assertAnUnpricedHourWithNoEnergyCostsNothing,
  assertKolkataMidnightIsTheDayBoundary,
  assertOneRateIsKwhTimesRate,
  assertTheNearestScopeWinsPerHour,
  assertTheOpenHourCountsOnlyTimePassed,
  assertTheScopeSumsItsAssetsPerDay,
  assertTheScopeZoneIsSharedOrTheOrganizations,
  assertTheWindowAndPeriodArithmetic,
  assertTotalsSumTheRoundedDays,
  assertTwoCurrenciesAreNullEveryDay,
} from "./energy-cost-by-day.spec";

/** `F4.332` — Vitest wrapper for the cost per local day (ADR 0070 Amendment 7). */
describe("F4.332 — the energy cost per local day, priced hour by hour at the dated rate", () => {
  it("prices one rate as kWh × rate", () => assertOneRateIsKwhTimesRate());
  it("splits a day at a mid-day rate change", () => assertAMidDayRateChangeSplitsTheDay());
  it("lets the nearest scope win hour by hour", () => assertTheNearestScopeWinsPerHour());
  it("re-prices only the days an edited old rate row covers", () => assertAnEditedOldRateRepricesOnlyItsDays());
  it("answers null with rate_missing for an unpriced hour with energy", () => assertAMissingRateIsNullWithTheReason());
  it("needs no rate for an hour with no energy", () => assertAnUnpricedHourWithNoEnergyCostsNothing());
  it("answers null with currency_mixed for two currencies", () => assertTwoCurrenciesAreNullEveryDay());
  it("answers null with no_energy for a day with no bucket", () => assertADayWithNoBucketIsNoEnergy());
  it("draws the day boundary at local midnight in Asia/Kolkata", () => assertKolkataMidnightIsTheDayBoundary());
  it("sums the scope's assets per day", () => assertTheScopeSumsItsAssetsPerDay());
  it("totals the rounded daily figures with coverage", () => assertTotalsSumTheRoundedDays());
  it("answers a total with no priced day as null with the reason", () => assertANoPricedDayTotalIsNullWithTheReason());
  it("counts windows and periods in calendar days", () => assertTheWindowAndPeriodArithmetic());
  it("counts days in the shared zone, else the organization's", () => assertTheScopeZoneIsSharedOrTheOrganizations());
  it("counts the open hour by the time passed", () => assertTheOpenHourCountsOnlyTimePassed());
});
