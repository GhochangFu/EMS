import { describe, it } from "vitest";

import { runDashboardsServiceUnitTests } from "./dashboards.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.1b — DashboardsService (pure logic, no database)", () => {
  it("maps rows to DTOs that parse against the shared contract, and diffs a widget set correctly", () => {
    runDashboardsServiceUnitTests();
  });
});
