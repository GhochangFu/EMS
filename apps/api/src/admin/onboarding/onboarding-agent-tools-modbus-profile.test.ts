import { describe, it } from "vitest";

import {
  assertAProfileIdOnAnMqttRtuIsRefused,
  assertAProfileIdWithoutAUnitIdIsRefused,
} from "./onboarding-agent-tools-modbus-profile.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 PR 11 — the agent's update_rtu and profileId (review L3, compliance S2)", () => {
  it("AP1 refuses profileId on an MQTT RTU, naming no key", () => assertAProfileIdOnAnMqttRtuIsRefused());
  it("AP2 refuses profileId on a Modbus RTU with no unit id", () => assertAProfileIdWithoutAUnitIdIsRefused());
});
