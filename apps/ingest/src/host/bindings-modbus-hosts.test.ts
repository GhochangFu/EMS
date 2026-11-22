import { describe, it } from "vitest";

import {
  assertAListedHostIsPlanned,
  assertAnUnlistedHostIsSkippedByName,
  assertMqttIsNotAffected,
  assertNoListDialsNothing,
} from "./bindings-modbus-hosts.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the cloud host dials only listed Modbus hosts (ADR 0141 decision 22)", () => {
  it("H1 a listed host or a host in a listed block is planned", () => assertAListedHostIsPlanned());
  it("H2 an unlisted host is skipped as modbus-host-not-allowed", () => assertAnUnlistedHostIsSkippedByName());
  it("H3 no list, or an empty one, dials nothing", () => assertNoListDialsNothing());
  it("H4 MQTT is not affected", () => assertMqttIsNotAffected());
});
