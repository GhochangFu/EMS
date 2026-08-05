import { describe, it } from "vitest";

import { runAssetTemplateSchemaTests } from "./asset-templates.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("asset-templates schema", () => {
  it("enforces the ADR 0015 template and point contracts", () => {
    runAssetTemplateSchemaTests();
  });
});
