import { describe, it } from "vitest";

import { runStockCatalogDeferralTests } from "./stock-catalog-deferrals.spec";

/**
 * Vitest entry point for `stock-catalog-deferrals.spec.ts` — assertions live in
 * the `.spec` sibling (ADR 0014).
 *
 * **A name-sibling wrapper and not a second runner inside
 * `stock-catalog.test.ts`.** `tests/repo-invariants.test.ts` pairs a spec with
 * its wrapper **by name**, not by import: a spec run from a differently-named
 * wrapper still executes, but it is **absent from coverage**, which is the half
 * of the failure the import cannot fix. `F2.12` wired its two class specs into
 * `stock-catalog.test.ts` and was red for four commits.
 */
describe("stock asset-template catalog — the deferral ledger (E5.2 Task 1)", () => {
  it("ships exactly the declared entries, in order, and declares none of their deferred codes", () => {
    runStockCatalogDeferralTests();
  });
});
