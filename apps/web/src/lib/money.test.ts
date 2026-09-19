import { describe, it } from "vitest";

import {
  assertACostIsTheReadyTile,
  assertFormatsWithIntl,
  assertFractionDigitsAreHonoured,
  assertNullAmountIsNull,
  assertNullCostIsTheEmptyTile,
  assertNullCurrencyIsNull,
  assertUnknownCodeFallsBack,
  assertUnsettledStatusPassesThrough,
} from "./money.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E4.1c — formatMoney", () => {
  it("formats with Intl.NumberFormat on the organization's currency code", () => {
    assertFormatsWithIntl();
  });

  it("honours maximumFractionDigits", () => {
    assertFractionDigitsAreHonoured();
  });

  it("answers null for a null amount", () => {
    assertNullAmountIsNull();
  });

  it("answers null for a null currency", () => {
    assertNullCurrencyIsNull();
  });

  it("falls back to amount plus code for a code ICU does not know", () => {
    assertUnknownCodeFallsBack();
  });
});

describe("E4.1c — costTileProps", () => {
  it("turns a settled null cost into the empty tile with the reason", () => {
    assertNullCostIsTheEmptyTile();
  });

  it("turns a settled cost into the ready tile with the Intl string", () => {
    assertACostIsTheReadyTile();
  });

  it("passes loading and error through untouched", () => {
    assertUnsettledStatusPassesThrough();
  });
});
