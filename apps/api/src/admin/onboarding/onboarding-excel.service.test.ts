import { describe, it } from "vitest";

import {
  assertDeclaredZipBombIsRefusedBeforeRead,
  assertOversizeBufferIsRefused,
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
});
