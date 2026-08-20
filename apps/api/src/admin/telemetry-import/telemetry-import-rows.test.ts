import { describe, it } from "vitest";

import { runTelemetryImportRowsTests } from "./telemetry-import-rows.spec";

/**
 * Vitest entry point. Assertions live in the sibling `.spec.ts` module
 * (ADR 0014). No database dependency — `parseWorkbook` is a pure function.
 */
describe("parseWorkbook", () => {
  it("parses CSV and XLSX rows, and rejects structurally or per-row as appropriate", () => {
    runTelemetryImportRowsTests();
  });
});
