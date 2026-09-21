import { describe, it } from "vitest";

import {
  assertCadencesAreExactlyTheThree,
  assertCapDefaultIsFifty,
  assertDeliveryStatusesAreTheFour,
  assertDtoRefusesObjectKey,
  assertFileDtoCarriesANullableScheduleId,
  assertFilenameRefusesAControlCharacter,
  assertFormatsAreExactlyPdfAndXlsx,
  assertFormatsRefuseAnEmptyArray,
  assertRunAtLocalRefusesSeconds,
  assertScheduleDtoRefusesAnUnknownKey,
  assertScheduleNameRefusesAControlCharacter,
  assertTemplateIdIsDerivedFromTheEnergyTemplate,
} from "./reports.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.5a — report file contracts (ADR 0071 decisions 4, 6, 11)", () => {
  it("parses a valid row and refuses one carrying objectKey", () => {
    assertDtoRefusesObjectKey();
  });

  it("closes the format vocabulary to exactly pdf and xlsx, in order", () => {
    assertFormatsAreExactlyPdfAndXlsx();
  });

  it("closes the delivery status vocabulary to exactly the four values, in order", () => {
    assertDeliveryStatusesAreTheFour();
  });

  it("derives reportTemplateIdSchema from energyReportTemplateSchema.shape.id by identity", () => {
    assertTemplateIdIsDerivedFromTheEnergyTemplate();
  });

  it("refuses a filename carrying a control character", () => {
    assertFilenameRefusesAControlCharacter();
  });

  it("defaults the on-demand cap to 50", () => {
    assertCapDefaultIsFifty();
  });

  it("carries a nullable scheduleId on the report file DTO", () => {
    assertFileDtoCarriesANullableScheduleId();
  });

  it("refuses an unknown key on the report schedule DTO", () => {
    assertScheduleDtoRefusesAnUnknownKey();
  });

  it("closes the cadence vocabulary to exactly the three values, in order", () => {
    assertCadencesAreExactlyTheThree();
  });

  it("refuses runAtLocal carrying seconds, and an out-of-range hour", () => {
    assertRunAtLocalRefusesSeconds();
  });

  it("refuses a schedule name carrying a control character", () => {
    assertScheduleNameRefusesAControlCharacter();
  });

  it("refuses an empty formats array", () => {
    assertFormatsRefuseAnEmptyArray();
  });
});
