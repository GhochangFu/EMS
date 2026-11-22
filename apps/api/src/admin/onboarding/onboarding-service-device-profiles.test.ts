import { describe, it } from "vitest";

import {
  assertTheChatTurnPersistsTheProfileId,
  assertTheUploadRefusesAnUnknownCode,
  assertTheUploadStoresTheResolvedProfileId,
} from "./onboarding-service-device-profiles.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 PR 11 — OnboardingService hands the profile lookup to the upload and the chat (review M1)", () => {
  it("SP1 stores the resolved id from a workbook code", () => assertTheUploadStoresTheResolvedProfileId());
  it("SP2 refuses a workbook code the organization does not hold", () => assertTheUploadRefusesAnUnknownCode());
  it("SP3 persists the id from a guided profile turn", () => assertTheChatTurnPersistsTheProfileId());
});
