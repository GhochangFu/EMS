import { describe, it } from "vitest";

import { runFacilityClassEntryTests5 } from "./facility-classes-5.spec";

/**
 * Vitest entry point for `facility-classes-5.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014), and `tests/repo-invariants.test.ts` requires the
 * wrapper to be its **name-sibling**: a spec imported from a differently-named
 * wrapper still runs, but it is excluded from coverage.
 *
 * The file holds §8b alone (the escalator, Task 14) — the entry that closes the
 * `E5.3` pack. §1 and §2 are in `facility-classes`, §3-§5 in `-2`, §6 and §7 in
 * `-3`, and §8a (the lift) in `-4`. The three pack-level claims run here too,
 * because this is the last entry commit and there is nowhere later for them.
 */
describe("stock asset-template catalog — the vertical-transport classes (E5.3, §8b)", () => {
  it("ships the escalator exactly as its tag-list section describes it, with the signed handrail deviation", () => {
    runFacilityClassEntryTests5();
  });
});
