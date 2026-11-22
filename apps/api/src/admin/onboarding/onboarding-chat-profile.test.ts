import { describe, it } from "vitest";

import {
  assertAnUnknownCodeIsRefusedWithoutEcho,
  assertAProfileBesideRegistersIsRefusedBySchema,
  assertAProfileTurnNamesTheProfileOnTheModbusRtu,
  assertAProfileTurnNeedsAModbusRtuAndALookup,
  assertAProfileTurnNeedsOneTarget,
  assertIngestOnNeedsAProfile,
  assertIngestOnNeedsOneTarget,
} from "./onboarding-chat-profile.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 PR 11 — the guided chat names a device profile (ADR 0141 decision 23)", () => {
  it("CP1 writes the profile on the last Modbus RTU and offers ingest on", () =>
    assertAProfileTurnNamesTheProfileOnTheModbusRtu());
  it("CP2 refuses an unknown code without repeating it", () => assertAnUnknownCodeIsRefusedWithoutEcho());
  it("CP3 needs a Modbus RTU and a lookup", () => assertAProfileTurnNeedsAModbusRtuAndALookup());
  it("CP4 switches ingest on only for a Modbus RTU naming a profile", () => assertIngestOnNeedsAProfile());
  it("CP5 leaves a profile beside the RTU's own registers to the schema's refusal", () =>
    assertAProfileBesideRegistersIsRefusedBySchema());
  it("CP6 refuses an ambiguous profile target and takes `for <RTU code>`", () => assertAProfileTurnNeedsOneTarget());
  it("CP7 refuses an ambiguous ingest target and takes `for <RTU code>`", () => assertIngestOnNeedsOneTarget());
});
