import { describe, it } from "vitest";

import { e41cPumpClaims, runMechanicalClassEntryTests } from "./mechanical-classes.spec";

/**
 * Vitest entry point for `mechanical-classes.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014), and `tests/repo-invariants.test.ts` requires the
 * wrapper to be its **name-sibling**: a spec imported from a differently-named
 * wrapper still runs, but it is excluded from coverage.
 *
 * The file holds §1 (the pump set, Task 6) and §2 (the VFD, Task 7); §3 and §4
 * are in `mechanical-classes-2`, §6 and §7 in `-3`. The runner is the seam, so
 * each entry commit adds one `check…()` call and nothing else moves.
 */
describe("stock asset-template catalog — the mechanical classes (E5.2, §§1 and 2)", () => {
  it("ships the pump set and the VFD exactly as their tag-list sections describe them", () => {
    runMechanicalClassEntryTests();
  });

  // E4.1c — the pump's three v3 rows, one it() per claim.
  for (const [name, run] of e41cPumpClaims()) {
    it(name, run);
  }
});
