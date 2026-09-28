import { describe, it } from "vitest";

import { runDashboardsSchemaMimicSourceShapeTests } from "./dashboards.schema.mimic.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.32 — the mimic widget binds nothing (ADR 0079)", () => {
  it("accepts an unbound mimic, refuses a point, and refuses an unrecognized config key", () => {
    runDashboardsSchemaMimicSourceShapeTests();
  });
});
