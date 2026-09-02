import { describe, it } from "vitest";

import { runElectricalClassEntryTests2 } from "./electrical-classes-2.spec";

/**
 * Vitest entry point for `electrical-classes-2.spec.ts` — assertions live in
 * the `.spec` sibling (ADR 0014), and `tests/repo-invariants.test.ts` requires
 * the wrapper to be its **name-sibling**. See `electrical-classes.test.ts`'s
 * docblock for why an import from another wrapper is not enough: the spec runs,
 * but it is excluded from coverage.
 */
describe("stock asset-template catalog — the electrical classes (F2.12, §§5-6)", () => {
  it("ships the solar PV and APFC classes exactly as their tag-list sections describe them", () => {
    runElectricalClassEntryTests2();
  });
});
