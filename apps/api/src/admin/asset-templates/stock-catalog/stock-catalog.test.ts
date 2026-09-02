import { describe, it } from "vitest";

import { runStockAssetTemplateCatalogTests } from "./stock-catalog.spec";

/**
 * Vitest entry point for `stock-catalog.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014).
 *
 * **One wrapper per spec, by name.** `F2.12` pass C moved the per-class blocks
 * out of `stock-catalog.spec.ts` (820 lines against the §4.5 cap) into
 * `electrical-classes.spec.ts`, and split those again at
 * `electrical-classes-2.spec.ts` when four blocks reached 959 lines. Tasks 4
 * and 7 wired both runners into *this* file, which looked tidier and is what
 * `tests/repo-invariants.test.ts` exists to refuse: it pairs `foo.spec.ts` with
 * `foo.test.ts` **by name**, because Vitest excludes `.spec` files from
 * coverage, so a spec reached only through another wrapper's import runs while
 * contributing nothing to the coverage gate. Each of the three specs now has
 * its own name-sibling.
 */
describe("stock asset-template catalog (F2.13, ADR 0052)", () => {
  it("ships entries that parse under both contracts, and the feeder class matches its tag list", () => {
    runStockAssetTemplateCatalogTests();
  });
});
