import { describe, it } from "vitest";

import { runCalcSchedulerExcludedTests } from "./calc-scheduler.excluded.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.9 — the excluded-members counter follows the write, not the aggregate", () => {
  it("does not count exclusions for a formula that refused after the aggregate resolved", async () => {
    await runCalcSchedulerExcludedTests();
  });
});
