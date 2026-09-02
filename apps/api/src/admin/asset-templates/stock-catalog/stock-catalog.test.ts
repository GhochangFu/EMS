import { describe, it } from "vitest";

import { runElectricalClassEntryTests } from "./electrical-classes.spec";
import { runStockAssetTemplateCatalogTests } from "./stock-catalog.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` files (ADR 0014).
 *
 * **Two runners, one wrapper.** `F2.12` pass C moved the per-class blocks into
 * `electrical-classes.spec.ts` because `stock-catalog.spec.ts` was at 820 lines
 * against the §4.5 cap. A second `.test.ts` would have split the catalog's
 * Vitest surface as well as its source, for no gain: the two runners are two
 * kinds of claim about one catalog, and they belong under one entry point.
 */
describe("stock asset-template catalog (F2.13, ADR 0052)", () => {
  it("ships entries that parse under both contracts, and the feeder class matches its tag list", () => {
    runStockAssetTemplateCatalogTests();
  });

  it("ships each electrical class exactly as its tag-list section describes it", () => {
    runElectricalClassEntryTests();
  });
});
