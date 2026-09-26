import { describe, it } from "vitest";

import { runLocationTypeCodeBoundsTests } from "./location-types.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.157 — locationTypeCodeSchema (ADR 0077 D1)", () => {
  it("C1 — accepts a live code, refuses an empty string and a 33-character code", () => {
    runLocationTypeCodeBoundsTests();
  });
});
