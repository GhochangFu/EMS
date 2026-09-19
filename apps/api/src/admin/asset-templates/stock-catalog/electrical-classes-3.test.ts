import { describe, it } from "vitest";

import { runFeederTagListBlock } from "./electrical-classes-3.spec";

/**
 * Vitest entry point for `electrical-classes-3.spec.ts` — assertions live in
 * the `.spec` sibling (ADR 0014), and `tests/repo-invariants.test.ts` requires
 * the wrapper to be its **name-sibling** (see `electrical-classes.test.ts`).
 */
describe("stock asset-template catalog — the feeder class (F2.13 §1, F2.8, E4.1c)", () => {
  it("matches tag list §1 and carries F2.8's three v2 rows (the block moved from stock-catalog.spec.ts)", () => {
    runFeederTagListBlock();
  });
});
