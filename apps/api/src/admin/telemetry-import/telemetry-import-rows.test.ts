import { describe, it } from "vitest";

import {
  runTelemetryImportColumnBoundTests,
  runTelemetryImportRangeOriginTests,
  runTelemetryImportRangeStartTests,
  runTelemetryImportReadingBoundTests,
  runTelemetryImportRowsTests,
} from "./telemetry-import-rows.spec";

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

  it(
    "refuses a sheet over the cap whose used range starts below row 1, and reads one at the cap whole",
    () => {
      runTelemetryImportRangeStartTests();
    },
    // Two more ~20,000-row workbooks, written as xlsx rather than CSV because
    // only a real sheet carries a `!ref` that starts below row 1.
    60_000,
  );

  it(
    "addresses rows and columns absolutely when the used range does not start at A1",
    () => {
      runTelemetryImportRangeOriginTests();
    },
    // Six tiny xlsx fixtures — four range origins, the decoy-column sheet and
    // the rejection sheet. No cap-sized workbook here.
    20_000,
  );

  it(
    "refuses a sheet whose reading was cut at the bound, and says that is what fired",
    () => {
      runTelemetryImportReadingBoundTests();
    },
    // One 25,000-row xlsx fixture, written deflated and read back; ~2 s alone on
    // the reference machine, and it shares the suite's CPU with every other
    // parallel file.
    60_000,
  );

  it(
    "bounds the column span a declared range may cost, and refuses a recognised header beyond it",
    () => {
      runTelemetryImportColumnBoundTests();
    },
    // The ceiling and anchor cases build no workbook at all. The four fixtures
    // that do are 100 columns wide and 2–3 rows deep, plus one declaring
    // A1:ZZ200 — writing is O(declared cells), which is why none of them
    // declares the full 16,384.
    20_000,
  );
});
