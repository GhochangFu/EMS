import { describe, it } from "vitest";

import {
  assertAFromGapIsRefused,
  assertAMidMonthDateIsRefused,
  assertAMixedBlankBasisResolves,
  assertANonContiguousKeyIsRefused,
  assertAWrongHeaderIsRefused,
  assertAnUnknownStatusIsRefused,
  assertSerialisationIsStable,
  assertTheHappyPathParses,
  assertTwoBasesAreRefused,
} from "./rate-chart.spec";

/** `F4.365` U3 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.365 — Rate Chart parser", () => {
  it("parses the happy path", () => assertTheHappyPathParses());
  it("resolves a key mixing blank and one basis (Haryana DS-II, plan D7)", () => assertAMixedBlankBasisResolves());
  it("refuses two different bases on one key", () => assertTwoBasesAreRefused());
  it("refuses a key whose rows are not contiguous", () => assertANonContiguousKeyIsRefused());
  it("refuses an unknown data status", () => assertAnUnknownStatusIsRefused());
  it("refuses a gap in slab bounds", () => assertAFromGapIsRefused());
  it("refuses an effective date not on day 01", () => assertAMidMonthDateIsRefused());
  it("refuses a wrong header row", () => assertAWrongHeaderIsRefused());
  it("serialises the same snapshot whatever the key order", () => assertSerialisationIsStable());
});
