import { describe, it } from "vitest";

import { runFacilityClassEntryTests2 } from "./facility-classes-2.spec";

/**
 * Vitest entry point for `facility-classes-2.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014), and `tests/repo-invariants.test.ts` requires the
 * wrapper to be its **name-sibling**: a spec imported from a differently-named
 * wrapper still runs, but it is excluded from coverage.
 *
 * The file holds §3 (the access door, Task 6), §4 (the occupancy zone, Task 7)
 * and §5 (the parking level, Task 8); §1 and §2 are in `facility-classes`, §6
 * and §7 in `-3`. The runner is the seam, so each entry commit adds one
 * `check…()` call and nothing else moves.
 */
describe("stock asset-template catalog — the facility classes (E5.3, §§3, 4 and 5)", () => {
  it("ships the access door exactly as its tag-list section describes it", () => {
    runFacilityClassEntryTests2();
  });
});
