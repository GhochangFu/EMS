import { describe, it } from "vitest";

import { runCalcStatusRegistryTests } from "./calc-status.registry.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("calc status registry — the last outcome per (assetId, templatePointId)", () => {
  it("keys on the pair, keeps the last outcome, and answers null for an unknown point", () => {
    runCalcStatusRegistryTests();
  });
});
