import { describe, it } from "vitest";

import { runElectricalClassEntryTests } from "./electrical-classes.spec";

/**
 * Vitest entry point for `electrical-classes.spec.ts` — assertions live in the
 * `.spec` sibling (ADR 0014).
 *
 * **A sibling wrapper and not a second runner inside `stock-catalog.test.ts`,
 * because `tests/repo-invariants.test.ts` requires exactly this.** That
 * invariant matches `foo.spec.ts` to `foo.test.ts` **by name**, not by import:
 * *"Assertions live in .spec files, but Vitest only discovers .test files — and
 * it excludes .spec files from coverage too, so an unwrapped spec is invisible
 * to both the runner and the coverage gate."* A spec imported by a
 * differently-named wrapper still runs, but it is **absent from coverage**,
 * which is the half of the failure the import cannot fix.
 *
 * `F2.12` Task 4 wired this file's runner into `stock-catalog.test.ts` instead
 * and Task 7 did the same for `electrical-classes-2.spec.ts`. Both were caught
 * by the full `pnpm test` at Task 8 and are fixed here — the filtered runner
 * (`pnpm --filter api exec vitest run src/admin/asset-templates/stock-catalog`)
 * cannot see the failure, because it does not run `tests/`.
 */
describe("stock asset-template catalog — the electrical classes (F2.12, §§2-4)", () => {
  it("ships the transformer, DG set and UPS classes exactly as their tag-list sections describe them", () => {
    runElectricalClassEntryTests();
  });
});
