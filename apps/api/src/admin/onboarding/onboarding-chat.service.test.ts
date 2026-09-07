import { describe, it } from "vitest";

import { assertExcelImportFollowUpBoundsEchoedText } from "./onboarding-chat.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("OnboardingChatService.excelImportFollowUp (F4.102)", () => {
  it("bounds every cell it echoes from the imported sheet", () => {
    assertExcelImportFollowUpBoundsEchoedText();
  });
});
