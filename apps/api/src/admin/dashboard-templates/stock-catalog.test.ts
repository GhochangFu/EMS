import { describe, it } from "vitest";

import {
  runStockCatalogCodesMatchTheParamCharsetTests,
  runStockCatalogTests,
  runSustainabilityCatalogKeysTest,
  runSustainabilityKeptTilesTest,
  runSustainabilityStockVersionTest,
  runSustainabilityTileBindingsTest,
  runSustainabilityWidgetCountTest,
} from "./stock-catalog.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("stock dashboard template catalog (F3.36 Part D, ADR 0049 decision 3)", () => {
  it("ships seven templates that parse under the frozen contract and match the seeded vocabularies", () => {
    runStockCatalogTests();
  });

  it("names every entry with a code the stock route parameter accepts (F3.44 sweep)", () => {
    runStockCatalogCodesMatchTheParamCharsetTests();
  });

  // **`E4.2` PR 2 review — one `it()` per claim, never one for all five.**
  // `assert` throws, so the single block these replace reported only its first
  // failure: `stockVersion: 1` and a wrong `aggregate` in the same edit printed
  // the stockVersion alone, and the four claims below it were unproven.
  it("sustainability-overview is stockVersion 2 (E4.2 PR 2)", () => {
    runSustainabilityStockVersionTest();
  });

  it("sustainability-overview carries 18 widgets", () => {
    runSustainabilityWidgetCountTest();
  });

  it("every new sustainability tile binds sustainability.total, and the table sustainability.by_location", () => {
    runSustainabilityCatalogKeysTest();
  });

  it("each of the fourteen sustainability tiles binds its own pointKey and aggregate", () => {
    runSustainabilityTileBindingsTest();
  });

  it("the three tiles kept from the v1 skeleton still bind their own catalog entries", () => {
    runSustainabilityKeptTilesTest();
  });
});
