import { describe, it } from "vitest";

import {
  assertOverlongCellsAreRefused,
  assertPartialWorkbookStillParses,
} from "./onboarding-excel-cell-bounds.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("OnboardingExcelService.parseUpload cell bounds (F4.104)", () => {
  it(
    "refuses every cell longer than the field it becomes, and keeps one at the bound whole",
    () => {
      assertOverlongCellsAreRefused();
    },
    // Twenty-eight workbooks, two per bounded cell plus the two credential
    // fixtures, each written and parsed. Small, but the vitest default (5s)
    // breaches under a full-suite run contending for CPU, as
    // `telemetry-import-rows.test.ts` records.
    60_000,
  );

  it("still parses a partial workbook, and leaves the blanks to the wizard's per-field errors", () => {
    assertPartialWorkbookStillParses();
  });
});
