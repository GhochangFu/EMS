import { describe, it } from "vitest";

import { runCalcSchedulerStatusTests } from "./calc-scheduler.status.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("calc scheduler host — what it records for the per-asset calc-points page", () => {
  it("records each asset's own outcome, and leaves a formula that was not due alone", async () => {
    await runCalcSchedulerStatusTests();
  });
});
