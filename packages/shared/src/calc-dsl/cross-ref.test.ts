import { describe, it } from "vitest";

import { runCrossRefKeyTests } from "./cross-ref.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("bms-calc-v2 crossRefKey", () => {
  it("builds one canonical key per cross-asset reference, and a qref key never meets an aggregate key", () => {
    runCrossRefKeyTests();
  });
});
