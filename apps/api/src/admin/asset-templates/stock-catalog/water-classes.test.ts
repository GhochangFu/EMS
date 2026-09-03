import { describe, it } from "vitest";

import { runWaterClassEntryTests } from "./water-classes.spec";

/**
 * Vitest entry point for `water-classes.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014).
 *
 * **A name-sibling wrapper and not a second runner inside
 * `stock-catalog.test.ts`, because `tests/repo-invariants.test.ts` requires
 * exactly this.** That invariant matches `foo.spec.ts` to `foo.test.ts` **by
 * name**, not by import: a spec imported by a differently-named wrapper still
 * runs, but it is **absent from coverage**, which is the half of the failure
 * the import cannot fix. `F2.12` wired its two class specs into
 * `stock-catalog.test.ts` and was red for four commits; the plan makes
 * `pnpm exec vitest run tests/repo-invariants.test.ts` part of every water
 * entry's gate for that reason.
 */
describe("stock asset-template catalog — the water classes (E5.1, §§4-6)", () => {
  it("ships the STP class exactly as its tag-list section describes it", () => {
    runWaterClassEntryTests();
  });
});
