import { describe, it } from "vitest";

import {
  assertAModbusProfileWithAUnitIdValidates,
  assertAProfileOnAnotherProtocolIsRefused,
  assertAProfileWithoutAUnitIdIsReportedAtTheUnitId,
  assertAnUnknownConfigKeyIsFixedText,
  assertNoProfileMessageEchoesTheValue,
} from "./onboarding-validate-modbus-profile.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 PR 11 — validate a draft that names a device profile (ADR 0141 decision 23)", () => {
  it("VP1 accepts a Modbus RTU naming a profile and a unit id", () => assertAModbusProfileWithAUnitIdValidates());
  it("VP2 reports a profile without a unit id at the unit id", () => assertAProfileWithoutAUnitIdIsReportedAtTheUnitId());
  it("VP3 refuses a profile on a non-Modbus RTU", () => assertAProfileOnAnotherProtocolIsRefused());
  it("VP4 echoes no refused profile reference", () => assertNoProfileMessageEchoesTheValue());
  it("VP5 forwards an unknown config key as fixed text (review L2)", () => assertAnUnknownConfigKeyIsFixedText());
});
