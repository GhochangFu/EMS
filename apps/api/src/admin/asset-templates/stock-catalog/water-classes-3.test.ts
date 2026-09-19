import { describe, it } from "vitest";

import { e41cWaterClaims, runWaterClassEntryTests3 } from "./water-classes-3.spec";

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

  // E4.1c — the v3 water rows of each class in this file, one it() per claim.
  for (const [name, run] of e41cWaterClaims()) {
    it(name, run);
  }
});
