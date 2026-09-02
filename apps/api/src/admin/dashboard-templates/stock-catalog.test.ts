import { describe, it } from "vitest";

import { runStockCatalogTests } from "./stock-catalog.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("stock dashboard template catalog (F3.36 Part D, ADR 0049 decision 3)", () => {
  it("ships seven templates that parse under the frozen contract and match the seeded vocabularies", () => {
    runStockCatalogTests();
  });
});
