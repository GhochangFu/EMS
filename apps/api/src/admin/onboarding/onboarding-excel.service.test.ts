import { describe, it } from "vitest";

import {
  assertDeclaredWidthIsRefusedNotWindowed,
  assertEchoedSheetTextIsBounded,
  assertDeclaredZipBombIsRefusedBeforeRead,
  assertOversizeBufferIsRefused,
  assertSheetReachingTheRowBoundIsRefused,
  assertTemplateRoundTripsUnchanged,
} from "./onboarding-excel.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("OnboardingExcelService.parseUpload (F4.102)", () => {
  it("parses the workbook it generates, unchanged", () => {
    assertTemplateRoundTripsUnchanged();
  });

  it("refuses a buffer over the file cap, and lets one exactly at it through to the parser", () => {
    assertOversizeBufferIsRefused();
  });

  it("refuses a zip whose central directory declares more than the inflation budget", () => {
    assertDeclaredZipBombIsRefusedBeforeRead();
  });

  it(
    "refuses a declared range wider than the column bound rather than windowing it",
    () => {
      assertDeclaredWidthIsRefusedNotWindowed();
    },
    // Four small workbooks, but one declares 702 columns and SheetJS writes
    // O(declared cells). The vitest default (5s) breaches under a full-suite
    // run contending for CPU, as `telemetry-import-rows.test.ts` records.
    60_000,
  );

  it(
    "refuses a sheet that reaches the reading bound, and reads one row under it whole",
    () => {
      assertSheetReachingTheRowBoundIsRefused();
    },
    // Three workbooks of ~20,000–25,000 rows, written and parsed.
    60_000,
  );

  it("bounds the sheet text the display-name fix reports, without bounding the name itself", () => {
    assertEchoedSheetTextIsBounded();
  });
});
