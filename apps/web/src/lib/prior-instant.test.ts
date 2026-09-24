import { describe, it } from "vitest";

import {
  handlesAMinuteBoundaryInput,
  isStableForTwoInputsInTheSameMinute,
  pinsExactOutputForAMidMinuteInput,
} from "./prior-instant.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 */
describe("F3.28 priorInstantIso", () => {
  it("pins the exact output for a mid-minute input", () => {
    pinsExactOutputForAMidMinuteInput();
  });

  it("is stable for two inputs in the same minute — the key-stability case", () => {
    isStableForTwoInputsInTheSameMinute();
  });

  it("handles a minute-boundary input", () => {
    handlesAMinuteBoundaryInput();
  });
});
