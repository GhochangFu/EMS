import { describe, it } from "vitest";

import {
  runStockCatalogCodesMatchTheParamCharsetTests,
  runStockCatalogTests,
  runSustainabilitySection2Tests,
} from "./stock-catalog.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("stock dashboard template catalog (F3.36 Part D, ADR 0049 decision 3)", () => {
  it("ships seven templates that parse under the frozen contract and match the seeded vocabularies", () => {
    runStockCatalogTests();
  });

  it("names every entry with a code the stock route parameter accepts (F3.44 sweep)", () => {
    runStockCatalogCodesMatchTheParamCharsetTests();
  });

  it("sustainability-overview is stockVersion 2: 18 widgets, sustainability.total tiles, sustainability.by_location table (E4.2 PR 2)", () => {
    runSustainabilitySection2Tests();
  });
});
