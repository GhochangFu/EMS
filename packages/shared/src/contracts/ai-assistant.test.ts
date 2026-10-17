import { describe, it } from "vitest";

import {
  assertSettingsDtoParsesAPlatformDefault,
  assertSettingsDtoParsesAnOrganizationRow,
  assertSettingsDtoRefusesAKeyField,
  assertSettingsDtoRequiresTheVisionModel,
  assertTestResultCarriesAnOptionalVisionStatus,
  assertTestStatusEnumIsTheSevenPlusOk,
} from "./ai-assistant.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.21 — the AI assistant settings DTO (ADR 0090 Amendment 1)", () => {
  it("parses an organization row", () => {
    assertSettingsDtoParsesAnOrganizationRow();
  });

  it("parses a platform default with a null key tail and timestamp", () => {
    assertSettingsDtoParsesAPlatformDefault();
  });

  it("refuses a key field, so a leaked secret fails the parse", () => {
    assertSettingsDtoRefusesAKeyField();
  });

  it("carries exactly ok plus the seven failure statuses, no_image_support last", () => {
    assertTestStatusEnumIsTheSevenPlusOk();
  });

  it("requires the vision model on the organization and the platform (F4.267)", () => {
    assertSettingsDtoRequiresTheVisionModel();
  });

  it("carries an optional vision status in the test result (F4.267)", () => {
    assertTestResultCarriesAnOptionalVisionStatus();
  });
});
