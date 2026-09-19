import { describe, it } from "vitest";

import {
  runDivisionByZeroTests,
  runInvalidClampRangeTests,
  runMissingInputTests,
  runNegativeZeroTests,
  runNonFiniteInputIsTreatedAsMissingTests,
  runPreviewComputesTests,
  runPreviewCrossRefsTests,
  runPreviewInputKeyTests,
  runPreviewWindowReadsTests,
  runUnparsedIsSilentTests,
  runV2MissingCrossInputTests,
  runV2PreviewComputesTests,
  runV3PreviewTests,
  runV3WindowPreviewComputesTests,
  runV3WindowPreviewRefusesTests,
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

  it("evaluates a bms-calc-v2 formula with one sample value per cross-asset reference", () => {
    runV2PreviewComputesTests();
  });

  it("reports a cross-asset reference with no sample value, positioned on the aggregate", () => {
    runV2MissingCrossInputTests();
  });

  it("lists the cross-asset references under v2, none under v1, and keeps the local list local", () => {
    runPreviewCrossRefsTests();
  });

  it("previews a bms-calc-v3 formula over a parameter sample row, and refuses at the $ without one", () => {
    runV3PreviewTests();
  });

  it("lists the window reads under v3, keyed by windowKey, and none under v2 (E4.1b)", () => {
    runPreviewWindowReadsTests();
  });

  it("previews delta({kwh}, today) / hours(today) as 35 over the window sample values", () => {
    runV3WindowPreviewComputesTests();
  });

  it("refuses at the window read, naming it, when no window sample value is given", () => {
    runV3WindowPreviewRefusesTests();
  });
});
