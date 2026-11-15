import { describe, it } from "vitest";

import {
  runAHiddenValueIsNotSummed,
  runAllHiddenIsNullNotZero,
  runAnEmptyScopeRunsNoQuery,
  runOnWithoutAValueIsShownWithNull,
  runTwoShownValuesAdd,
} from "./estate-energy.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.375 — summariseEstateEnergy (ADR 0133 Amendment 2 ruling 1)", () => {
  it("S1 — every location hidden is not shown, null, never 0", () => {
    runAllHiddenIsNullNotZero();
  });

  it("S2 — an on location with no kw value is shown with a null total", () => {
    runOnWithoutAValueIsShownWithNull();
  });

  it("S3 — a hidden location's value is not summed", () => {
    runAHiddenValueIsNotSummed();
  });

  it("S4 — two shown values add", () => {
    runTwoShownValuesAdd();
  });

  it("S5 — an empty asset scope runs no query", async () => {
    await runAnEmptyScopeRunsNoQuery();
  });
});
