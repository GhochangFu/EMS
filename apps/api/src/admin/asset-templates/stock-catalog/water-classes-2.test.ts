import { describe, it } from "vitest";

import { runWaterClassEntryTests2 } from "./water-classes-2.spec";

/**
 * Vitest entry point for `water-classes-2.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014), and `tests/repo-invariants.test.ts` requires the
 * wrapper to be its **name-sibling**. See `water-classes.test.ts`'s docblock
 * for why an import from another wrapper is not enough: the spec runs, but it
 * is excluded from coverage.
 */
describe("stock asset-template catalog — the water classes (E5.1, §§1 and 4)", () => {
  it("ships the cooling tower and WTP classes exactly as their tag-list sections describe them", () => {
    runWaterClassEntryTests2();
  });
});
