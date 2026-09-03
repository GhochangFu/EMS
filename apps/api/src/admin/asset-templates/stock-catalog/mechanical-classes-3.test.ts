import { describe, it } from "vitest";

import { runMechanicalClassEntryTests3 } from "./mechanical-classes-3.spec";

/**
 * Vitest entry point for `mechanical-classes-3.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014), and `tests/repo-invariants.test.ts` requires the
 * wrapper to be its **name-sibling**: a spec imported from a differently-named
 * wrapper still runs, but it is excluded from coverage.
 *
 * The file holds §6 (the air handling unit, Task 10) and §7 (the steam boiler,
 * Task 11); §1 and §2 are in `mechanical-classes`, §3 and §4 in `-2`. The runner
 * is the seam, so each entry commit adds one `check…()` call and nothing else
 * moves.
 */
describe("stock asset-template catalog — the mechanical classes (E5.2, §§6 and 7)", () => {
  it("ships the air handling unit and the boiler exactly as their tag-list sections describe them", () => {
    runMechanicalClassEntryTests3();
  });
});
