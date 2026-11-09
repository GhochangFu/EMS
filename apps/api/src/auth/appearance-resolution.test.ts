import { describe, it } from "vitest";

import { runThePrecedenceTable } from "./appearance-resolution.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.341 resolveAppearance (ADR 0118 decision 8)", () => {
  it("resolves each choice user > organization > portal, with its level", () => {
    runThePrecedenceTable();
  });
});
