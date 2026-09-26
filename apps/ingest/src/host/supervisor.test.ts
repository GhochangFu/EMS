import { describe, it } from "vitest";

import { runPointLivenessTests, runSupervisorTests } from "./supervisor.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("endpoint supervisor", () => {
  it("owns every timer, backs off, and keeps its blast radius to one endpoint", async () => {
    await runSupervisorTests();
  });

  it("keeps last-seen per bound point, stamped only by a live sample (F4.58)", async () => {
    await runPointLivenessTests();
  });
});
