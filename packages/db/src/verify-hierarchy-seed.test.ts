import { describe, it } from "vitest";

import {
  assertAFloorFailsOneBelow,
  assertAFloorPassesAtTheFloor,
  assertAnExactMatchGivesNothing,
  assertAnExactMismatchNamesLabelAndBothNumbers,
  assertFailuresKeepInputOrder,
  assertNaNFailsAFloor,
  assertNaNFailsAnExactCheck,
} from "./verify-hierarchy-seed.spec";

describe("F4.169/F4.170 addendum — failingChecks decides the boot gate and fails closed", () => {
  it("fails an exact mismatch with the label and both numbers", () => {
    assertAnExactMismatchNamesLabelAndBothNumbers();
  });

  it("gives nothing for an exact match", () => {
    assertAnExactMatchGivesNothing();
  });

  it("passes a floor at the floor and above it", () => {
    assertAFloorPassesAtTheFloor();
  });

  it("fails a floor one below", () => {
    assertAFloorFailsOneBelow();
  });

  it("fails an exact check on NaN", () => {
    assertNaNFailsAnExactCheck();
  });

  it("fails a floor on NaN", () => {
    assertNaNFailsAFloor();
  });

  it("keeps failures in input order", () => {
    assertFailuresKeepInputOrder();
  });
});
