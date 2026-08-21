import { describe, it } from "vitest";

import {
  runDivisionByZeroTests,
  runInvalidClampRangeTests,
  runMissingInputTests,
  runNegativeZeroTests,
  runNonFiniteInputIsTreatedAsMissingTests,
  runPreviewComputesTests,
  runPreviewInputKeyTests,
  runUnparsedIsSilentTests,
} from "./calc-preview.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("calc live preview", () => {
  it("evaluates a formula over sample values", () => {
    runPreviewComputesTests();
  });

  it("reports a point with no sample value, positioned on the reference", () => {
    runMissingInputTests();
  });

  it("treats a non-finite sample value as missing, not as an overflow", () => {
    runNonFiniteInputIsTreatedAsMissingTests();
  });

  it("refuses division by zero at the divide node instead of showing Infinity", () => {
    runDivisionByZeroTests();
  });

  it("normalises negative zero to zero", () => {
    runNegativeZeroTests();
  });

  it("reports a bad clamp range as its own refusal", () => {
    runInvalidClampRangeTests();
  });

  it("stays silent while the expression does not parse", () => {
    runUnparsedIsSilentTests();
  });

  it("lists the input keys a formula needs, deduplicated in source order", () => {
    runPreviewInputKeyTests();
  });
});
