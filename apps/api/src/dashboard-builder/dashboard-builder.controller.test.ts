import { describe, it } from "vitest";

import { runDashboardBuilderControllerTests } from "./dashboard-builder.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.1b — DashboardBuilderController (stubbed service)", () => {
  it("gates every mutating route before the service, and parses each body against its schema", async () => {
    await runDashboardBuilderControllerTests();
  });
});
