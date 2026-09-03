import { describe, it } from "vitest";

import { runWaterClassEntryTests3 } from "./water-classes-3.spec";

/**
 * Vitest entry point for `water-classes-3.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014), and `tests/repo-invariants.test.ts` requires the
 * wrapper to be its **name-sibling**. See `water-classes.test.ts`'s docblock
 * for why an import from another wrapper is not enough: the spec runs, but it
 * is excluded from coverage.
 */
describe("stock asset-template catalog — the water classes (E5.1, §§2 and 3)", () => {
  it("ships the RO and softener classes exactly as their tag-list sections describe them", () => {
    runWaterClassEntryTests3();
  });
});
