import { describe, it } from "vitest";

import { runFacilityClassEntryTests4 } from "./facility-classes-4.spec";

/**
 * Vitest entry point for `facility-classes-4.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014), and `tests/repo-invariants.test.ts` requires the
 * wrapper to be its **name-sibling**: a spec imported from a differently-named
 * wrapper still runs, but it is excluded from coverage.
 *
 * The file holds §8a alone (the lift, Task 13) — 80 points against the fire
 * panel's 24, which is why PR 2's two entries take a file each. §1 and §2 are in
 * `facility-classes`, §3-§5 in `-2`, §6 and §7 in `-3`, and §8b arrives in `-5`.
 */
describe("stock asset-template catalog — the vertical-transport classes (E5.3, §8a)", () => {
  it("ships the lift exactly as its tag-list section describes it, citing the document its prefix does not", () => {
    runFacilityClassEntryTests4();
  });
});
