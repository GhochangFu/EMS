import { describe, it } from "vitest";

import { runFacilityClassEntryTests3 } from "./facility-classes-3.spec";

/**
 * Vitest entry point for `facility-classes-3.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014), and `tests/repo-invariants.test.ts` requires the
 * wrapper to be its **name-sibling**: a spec imported from a differently-named
 * wrapper still runs, but it is excluded from coverage.
 *
 * The file holds §6 (the indoor air quality node, Task 9) and §7 (the BAS
 * gateway, Task 10); §1 and §2 are in `facility-classes`, §3, §4 and §5 in `-2`.
 * The runner is the seam, so each entry commit adds one `check…()` call and
 * nothing else moves.
 */
describe("stock asset-template catalog — the facility classes (E5.3, §§6 and 7)", () => {
  it("ships the indoor air quality node and the BAS gateway exactly as their tag-list sections describe them", () => {
    runFacilityClassEntryTests3();
  });
});
