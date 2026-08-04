import { describe, it } from "vitest";

import { runAdminSchemaTests } from "./admin.schema.spec";

/**
 * Vitest entry point. The assertions live in the sibling `.spec.ts` module so
 * they stay framework-agnostic and byte-identical through the runner migration
 * (ADR 0014). They convert to individual `it()` cases as feature work touches
 * this file — not as part of standing up the harness.
 */
describe("admin.schema", () => {
  it("accepts and rejects admin request payloads", () => {
    runAdminSchemaTests();
  });
});
