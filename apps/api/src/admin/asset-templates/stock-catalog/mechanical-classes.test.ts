import { describe, it } from "vitest";

import { runMechanicalClassEntryTests } from "./mechanical-classes.spec";

/**
 * Vitest entry point for `mechanical-classes.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014), and `tests/repo-invariants.test.ts` requires the
 * wrapper to be its **name-sibling**: a spec imported from a differently-named
 * wrapper still runs, but it is excluded from coverage.
 *
 * The title says §1 and §2 because that is what the file will hold once Task 7
 * lands the VFD; the pump arrives first (Task 6) and the runner is the seam.
 */
describe("stock asset-template catalog — the mechanical classes (E5.2, §§1 and 2)", () => {
  it("ships the pump set exactly as its tag-list section describes it", () => {
    runMechanicalClassEntryTests();
  });
});
