import { describe, it } from "vitest";

import { runDialectSupersetTests } from "./dialect-superset.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("ADR 0055 decision 4 — bms-calc-v2 is a strict superset of bms-calc-v1", () => {
  it("parses every seeded v1-grammar expression and the v1 spec corpus identically under v2, or explains why not", () => {
    runDialectSupersetTests();
  });
});
