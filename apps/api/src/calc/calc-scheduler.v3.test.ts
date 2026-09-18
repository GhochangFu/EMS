import { describe, it } from "vitest";

import { runV3SweepTests } from "./calc-scheduler.v3.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * Split from `calc-scheduler.test.ts` because its spec reached the §4.5
 * line cap; the harness (`buildSweepDeps`, `def`) is shared by import. */
describe("bms-calc-v3 in the scheduled sweep (ADR 0070)", () => {
  it("resolves $key parameters once per sweep, refuses parameter_unset with no row written, and contains a failed read", async () => {
    await runV3SweepTests();
  });
});
