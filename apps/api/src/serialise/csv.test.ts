import { describe, it } from "vitest";

import { runCsvSerialiseTests } from "./csv.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("shared csv serialise (ADR 0026)", () => {
  it("quotes, neutralises formula leaders, and leaves numbers alone", () => {
    runCsvSerialiseTests();
  });
});
