import { describe, it } from "vitest";

import { runSleepTests } from "./sleep.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("sleep", () => {
  it("resolves after its delay, or promptly on abort", async () => {
    await runSleepTests();
  });
});
