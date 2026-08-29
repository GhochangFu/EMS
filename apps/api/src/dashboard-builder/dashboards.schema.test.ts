import { describe, it } from "vitest";

import { runDashboardsSchemaTests } from "./dashboards.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.1b — dashboard request bodies", () => {
  it("refuses unknown keys, both scope columns, over-cardinality, inverted ranges, and duplicate bindings", () => {
    runDashboardsSchemaTests();
  });
});
