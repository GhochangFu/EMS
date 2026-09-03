import { describe, it } from "vitest";

import { runFacilityClassEntryTests } from "./facility-classes.spec";

/**
 * Vitest entry point for `facility-classes.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014), and `tests/repo-invariants.test.ts` requires the
 * wrapper to be its **name-sibling**: a spec imported from a differently-named
 * wrapper still runs, but it is excluded from coverage.
 *
 * The file holds §1 (the lighting zone, Task 4) and §2 (the fire alarm panel,
 * Task 5); §3, §4 and §5 are in `facility-classes-2`, §6 and §7 in `-3`. The
 * runner is the seam, so each entry commit adds one `check…()` call and nothing
 * else moves.
 */
describe("stock asset-template catalog — the facility classes (E5.3, §§1 and 2)", () => {
  it("ships the lighting zone exactly as its tag-list section describes it", () => {
    runFacilityClassEntryTests();
  });
});
