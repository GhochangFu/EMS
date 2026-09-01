import { describe, it } from "vitest";

import { runDashboardTemplatesControllerTests } from "./dashboard-templates.controller.spec";

/** `F3.36` Part E3 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014). */
describe("F3.36 — dashboard template controller route order", () => {
  it("declares the literal /stock route before the parameterised /:id route", () => {
    runDashboardTemplatesControllerTests();
  });
});
