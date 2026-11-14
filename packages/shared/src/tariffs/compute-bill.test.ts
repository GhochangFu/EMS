import { describe, it } from "vitest";

import {
  GOLDEN,
  assertBilledUnitsRules,
  assertChargesAreTheSumOfTheRoundedLines,
  assertFixedFractionScalesOnlyTheFixedCharge,
  assertGoldenBill,
  assertInvalidInputThrows,
  assertOverflowTakesTheLastSlabRate,
} from "./compute-bill.spec";

/** `F4.365` U1 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.365 — computeBill golden bills (ADR 0134 decision 6)", () => {
  for (const golden of GOLDEN) {
    it(golden.name, () => {
      assertGoldenBill(golden);
    });
  }
});

describe("F4.365 — computeBill rules", () => {
  it("bills units above a closed last slab at the last slab's rate (Amendment 1)", () => {
    assertOverflowTakesTheLastSlabRate();
  });

  it("fixedFraction scales only the fixed charge (Amendment 1)", () => {
    assertFixedFractionScalesOnlyTheFixedCharge();
  });

  it("refuses negative or non-finite units", () => {
    assertInvalidInputThrows();
  });

  it("energy and wheeling are the sums of the rounded slab lines", () => {
    assertChargesAreTheSumOfTheRoundedLines();
  });

  it("billedUnits: kWh delta, measured kVAh, kVAh estimated from kWh ÷ pf", () => {
    assertBilledUnitsRules();
  });
});
