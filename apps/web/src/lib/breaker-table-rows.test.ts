import { describe, it } from "vitest";

import { rowStateExcludesTrippedAndUnknown } from "./breaker-table-rows.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.74 — BreakerRowState", () => {
  it("a rule-derived row state is never tripped or unknown (checked by tsc)", () => {
    rowStateExcludesTrippedAndUnknown();
  });
});
