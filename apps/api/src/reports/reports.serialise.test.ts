import { describe, it } from "vitest";

import { runReportsSerialiseTests, runReportsSheetTests } from "./reports.serialise.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("energy report serialise (ADR 0026)", () => {
  it("guards the three untrusted cells without touching numbers or benign data", () => {
    runReportsSerialiseTests();
  });

  it("shapes the xlsx rows unguarded, keeps numbers numeric, and mirrors the CSV layout", () => {
    runReportsSheetTests();
  });
});
