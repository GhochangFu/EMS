import { describe, it } from "vitest";

import {
  assertAssetsByRtuSummaryIsIndexedNotRescanned,
  assertExcelImportFollowUpBoundsEchoedText,
} from "./onboarding-chat.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("OnboardingChatService.excelImportFollowUp (F4.102)", () => {
  it("bounds every cell it echoes from the imported sheet", () => {
    assertExcelImportFollowUpBoundsEchoedText();
  });

  it(
    "indexes the assets by RTU instead of rescanning them per RTU",
    () => {
      assertAssetsByRtuSummaryIsIndexedNotRescanned();
    },
    // 10,050 RTUs and 10,050 assets. The quadratic version this replaced took
    // ~2 s, and a contended full-suite run breaches the 5 s vitest default
    // while the assertion itself is still the thing being measured.
    60_000,
  );
});
