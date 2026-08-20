import { describe, it } from "vitest";

import { runSourceKindSchemaTests } from "./source-kind.schema.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("telemetry-entry source-kind schema", () => {
  it("parses and rejects the ADR 0018 source_kind contract as documented", () => {
    runSourceKindSchemaTests();
  });
});
