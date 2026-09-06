import { describe, it } from "vitest";

import { runSweepLoopTests } from "./sweep-loop.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("sweep loop — runSweepLoop", () => {
  it("sweeps before it sleeps, warns a throwing sweep and continues, and stops on abort", async () => {
    await runSweepLoopTests();
  });
});
