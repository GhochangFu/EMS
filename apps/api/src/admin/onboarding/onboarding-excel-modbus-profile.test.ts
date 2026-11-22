import { describe, it } from "vitest";

import {
  assertABadCellIsRefusedWithoutEcho,
  assertAModbusRowCarriesItsUnitIdAndProfileCode,
  assertAProfileCodeOnAnotherProtocolIsRefused,
  assertTheTemplateNamesTheTwoColumnsLast,
  assertTheUploadResolvesTheCodeToTheOrganizationsProfile,
} from "./onboarding-excel-modbus-profile.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 PR 11 — the workbook names a device profile by code (ADR 0141 decision 23)", () => {
  it("XP1 names unit_id and profile_code after the nine older columns", () => assertTheTemplateNamesTheTwoColumnsLast());
  it("XP2 carries a Modbus row's unit id and profile code", () => assertAModbusRowCarriesItsUnitIdAndProfileCode());
  it("XP3 refuses a bad unit id or profile code without echo", () => assertABadCellIsRefusedWithoutEcho());
  it("XP4 refuses a profile code on a non-Modbus row", () => assertAProfileCodeOnAnotherProtocolIsRefused());
  it("XP5 resolves the code to the organization's profile at upload", () =>
    assertTheUploadResolvesTheCodeToTheOrganizationsProfile());
});
