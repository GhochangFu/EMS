import { describe, it } from "vitest";

import {
  assertAMappedAssetIsTheBillRate,
  assertARangeEndingOnAMonthsLastDayIsThatMonth,
  assertATwoMonthRangePricesEachMonthAtItsRate,
  assertAnUnpricedMonthWithEnergyFailsClosed,
  assertTheBlendUsesTheFlatRowOutsideMappedMonths,
  assertAMonthBeforeTheMappingIsFlat,
  assertAnUnmappedAssetDelegates,
  assertAnUnpricedMappedAssetDoesNotFallBack,
  assertOneBillPerMappingMonth,
  assertOtherKeysPassThrough,
  assertTheSeriesPutsMappedMonthsFirst,
  assertVerifyFollowsTheDataStatus,
} from "./energy-rate-resolver.spec";

/** `F4.365` U7 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.365 — EnergyRateResolver", () => {
  it("delegates an unmapped asset to the flat parameter", () => assertAnUnmappedAssetDelegates());
  it("prices a mapped asset at bill total ÷ meter kWh, month to date, fixed prorated", () => assertAMappedAssetIsTheBillRate());
  it("computes one bill per mapping and month", () => assertOneBillPerMappingMonth());
  it("leaves an unpriced mapped asset absent and does not fall back", () => assertAnUnpricedMappedAssetDoesNotFallBack());
  it("uses the flat parameter for a month the mapping does not cover", () => assertAMonthBeforeTheMappingIsFlat());
  it("passes other keys through", () => assertOtherKeysPassThrough());
  it("raises verify for a non-official version", () => assertVerifyFollowsTheDataStatus());
  it("puts mapped months first in the series, NaN when unpriced", () => assertTheSeriesPutsMappedMonthsFirst());
  it("prices a range ending on a month's last local day at that month", () => assertARangeEndingOnAMonthsLastDayIsThatMonth());
  it("prices each month of a two-month range at its own rate", () => assertATwoMonthRangePricesEachMonthAtItsRate());
  it("fails a range closed when a month with energy is unpriced", () => assertAnUnpricedMonthWithEnergyFailsClosed());
  it("blends the flat row outside mapped months", () => assertTheBlendUsesTheFlatRowOutsideMappedMonths());
});
