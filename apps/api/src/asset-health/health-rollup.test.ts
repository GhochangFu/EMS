import { describe, it } from "vitest";

import { runHealthRollupTests } from "./health-rollup.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("health-rollup", () => {
  it("sweeps every organization finest-first, and survives one that fails", async () => {
    await runHealthRollupTests();
  });
});
