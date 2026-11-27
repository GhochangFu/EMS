import { describe, it } from "vitest";

import {
  assertANonIntegerAStringAndNullAreRefused,
  assertBothBoundsAreAccepted,
  assertOneAboveTheCeilingIsRefused,
  assertOneBelowTheFloorIsRefused,
  assertTheBoundsAreOneSecondAndOneHour,
} from "./ingest-poll-interval.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the poll interval bound (ADR 0141 decision 10)", () => {
  it("I1 pins the bounds at 1,000 and 3,600,000 ms", () => {
    assertTheBoundsAreOneSecondAndOneHour();
  });

  it("I2 accepts both bounds", () => {
    assertBothBoundsAreAccepted();
  });

  it("I3 refuses 999", () => {
    assertOneBelowTheFloorIsRefused();
  });

  it("I4 refuses 3,600,001", () => {
    assertOneAboveTheCeilingIsRefused();
  });

  it("I5 refuses a fraction, a string and null", () => {
    assertANonIntegerAStringAndNullAreRefused();
  });
});
