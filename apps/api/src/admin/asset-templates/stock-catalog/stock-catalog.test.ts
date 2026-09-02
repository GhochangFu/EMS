import { describe, it } from "vitest";

import { runStockAssetTemplateCatalogTests } from "./stock-catalog.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("stock asset-template catalog (F2.13, ADR 0052)", () => {
  it("ships entries that parse under both contracts, and the feeder class matches its tag list", () => {
    runStockAssetTemplateCatalogTests();
  });
});
