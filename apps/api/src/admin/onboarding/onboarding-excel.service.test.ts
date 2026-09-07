import { describe, it } from "vitest";

import { assertTemplateRoundTripsUnchanged } from "./onboarding-excel.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("OnboardingExcelService.parseUpload (F4.102)", () => {
  it("parses the workbook it generates, unchanged", () => {
    assertTemplateRoundTripsUnchanged();
  });
});
