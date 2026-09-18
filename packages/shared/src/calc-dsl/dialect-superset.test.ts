import { describe, it } from "vitest";

import { runDialectSupersetTests } from "./dialect-superset.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("ADR 0055 decision 4 / ADR 0070 decision 3 — each bms-calc dialect is a strict superset of its predecessor", () => {
  it("parses every seeded generated and corpus expression identically across (v1,v2), (v1,v3) and (v2,v3), or explains why not", () => {
    runDialectSupersetTests();
  });
});
