import { describe, it } from "vitest";

import { runOnboardingPreviewAutoOpenTests } from "./onboarding-preview-auto-open.spec";

/** Vitest entry point — see `apps/api/src/admin/admin.schema.test.ts` (ADR 0014). */
describe("onboarding-preview-auto-open", () => {
  it("opens on a new reason and stays shut on a dismissed one", () => {
    runOnboardingPreviewAutoOpenTests();
  });
});
