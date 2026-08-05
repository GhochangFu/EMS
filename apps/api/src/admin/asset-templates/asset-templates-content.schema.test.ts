import { describe, it } from "vitest";

import { runTemplateContentSchemaTests } from "./asset-templates-content.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("asset-templates content schema", () => {
  it("enforces the ADR 0019 tiered content contract", () => {
    runTemplateContentSchemaTests();
  });
});
