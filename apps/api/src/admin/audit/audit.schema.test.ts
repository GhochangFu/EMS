import { describe, it } from "vitest";

import { runAuditSchemaTests } from "./audit.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("audit schema", () => {
  it("enforces the ADR 0021 list and export query contracts", () => {
    runAuditSchemaTests();
  });
});
