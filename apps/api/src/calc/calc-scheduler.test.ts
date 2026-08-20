import { describe, it } from "vitest";

import { runCalcSchedulerTests } from "./calc-scheduler.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("calc scheduler host — runScheduledSweep and runSchedulerLoop", () => {
  it("gates on isDue, survives one formula's failure, never overlaps, and stops promptly on abort", async () => {
    await runCalcSchedulerTests();
  });
});
