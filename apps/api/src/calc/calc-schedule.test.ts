import { describe, it } from "vitest";

import { runCalcScheduleTests } from "./calc-schedule.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("calc schedule — bucketTimeMs and isDue", () => {
  it("truncates on absolute epoch boundaries and tracks per-formula due-ness", () => {
    runCalcScheduleTests();
  });
});
