import { describe, it } from "vitest";

import {
  assertAbsentTariffIsNullNotZero,
  assertEqualTariffsInTwoCurrenciesIsNull,
  assertMixedCurrencyIsNull,
  assertNoRowsIsNull,
  assertNonFiniteKwhIsNull,
  assertOneCurrencyOneTariffSums,
  assertOrphanTelemetryIsNull,
  assertRoundsToTwoDecimals,
  assertStrayTariffIsIgnored,
  assertTwoTariffsSumPerAsset,
} from "./energy-cost.spec";

/** `E4.1c` — Vitest wrapper for the pure indicative-cost assertions (ADR 0014). */
describe("E4.1c — energyCost, the three fail-closed rules", () => {
  it("C1 sums one currency at one tariff and reports both", () => {
    assertOneCurrencyOneTariffSums();
  });

  it("C2 answers null, not 0, when one asset has no tariff", () => {
    assertAbsentTariffIsNullNotZero();
  });

  it("C3 answers null for every field across two currencies", () => {
    assertMixedCurrencyIsNull();
  });

  it("C4 sums per asset under two tariffs and reports no single tariff", () => {
    assertTwoTariffsSumPerAsset();
  });

  it("C5 answers null for every field on an empty scope", () => {
    assertNoRowsIsNull();
  });

  it("C6 rounds the cost to two decimals", () => {
    assertRoundsToTwoDecimals();
  });

  it("C7 ignores a tariff for an asset that is not in the rows", () => {
    assertStrayTariffIsIgnored();
  });

  it("C8 answers null for a non-finite kWh rather than writing NaN", () => {
    assertNonFiniteKwhIsNull();
  });

  it("C9 reports no single tariff when the same number spans two currencies", () => {
    assertEqualTariffsInTwoCurrenciesIsNull();
  });

  it("C10 fails closed on a row with no currency", () => {
    assertOrphanTelemetryIsNull();
  });
});
