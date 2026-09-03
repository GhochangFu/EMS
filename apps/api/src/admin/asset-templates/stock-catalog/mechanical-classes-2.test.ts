import { describe, it } from "vitest";

import { runMechanicalClassEntryTests2 } from "./mechanical-classes-2.spec";

/**
 * Vitest entry point for `mechanical-classes-2.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014), and `tests/repo-invariants.test.ts` requires the
 * wrapper to be its **name-sibling**: a spec imported from a differently-named
 * wrapper still runs, but it is excluded from coverage.
 *
 * The file holds §3 (the air compressor, Task 8) and §4 (the chiller, Task 9);
 * §1 and §2 are in `mechanical-classes`, §6 and §7 in `-3`. The runner is the
 * seam, so each entry commit adds one `check…()` call and nothing else moves.
 */
describe("stock asset-template catalog — the mechanical classes (E5.2, §§3 and 4)", () => {
  it("ships the air compressor and the chiller exactly as their tag-list sections describe them", () => {
    runMechanicalClassEntryTests2();
  });
});
