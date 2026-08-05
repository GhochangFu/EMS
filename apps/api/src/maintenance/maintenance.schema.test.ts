import { describe, it } from "vitest";

import { runMaintenanceSchemaTests } from "./maintenance.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("maintenance schema", () => {
  it("keeps the priority filter derived from the exported enum", () => {
    runMaintenanceSchemaTests();
  });
});
