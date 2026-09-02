import { describe, it } from "vitest";

import { runElectricalClassEntryTests2 } from "./electrical-classes-2.spec";
import { runElectricalClassEntryTests } from "./electrical-classes.spec";
import { runStockAssetTemplateCatalogTests } from "./stock-catalog.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` files (ADR 0014).
 *
 * **Three runners, one wrapper.** `F2.12` pass C moved the per-class blocks
 * into `electrical-classes.spec.ts` because `stock-catalog.spec.ts` was at 820
 * lines against the §4.5 cap, and split them again at `electrical-classes-2`
 * (Task 7) when four blocks took the first file to 959. A second or third
 * `.test.ts` would have split the catalog's Vitest surface as well as its
 * source, for no gain: these are two kinds of claim about one catalog — the
 * mechanism's, and the tag list's — and they belong under one entry point.
 */
describe("stock asset-template catalog (F2.13, ADR 0052)", () => {
  it("ships entries that parse under both contracts, and the feeder class matches its tag list", () => {
    runStockAssetTemplateCatalogTests();
  });

  it("ships each electrical class exactly as its tag-list section describes it", () => {
    runElectricalClassEntryTests();
  });

  it("ships the solar PV and APFC classes exactly as their tag-list sections describe them", () => {
    runElectricalClassEntryTests2();
  });
});
