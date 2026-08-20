import { describe, it } from "vitest";

import { runTelemetryImportRowsTests } from "./telemetry-import-rows.spec";

/**
 * Vitest entry point. Assertions live in the sibling `.spec.ts` module
 * (ADR 0014). No database dependency — `parseWorkbook` is a pure function.
 */
describe("parseWorkbook", () => {
  it(
    "parses CSV and XLSX rows, and rejects structurally or per-row as appropriate",
    () => {
      runTelemetryImportRowsTests();
    },
    // Three fixtures build and parse a ~20,000-row workbook (over-cap,
    // at-cap, and the cap-with-a-trailing-blank-row case added for the
    // M2/C4 review fixes). Comfortably under a second alone; the vitest
    // default (5s) was observed to breach under a full-suite run
    // contending for CPU with every other parallel test file.
    20_000,
  );
});
