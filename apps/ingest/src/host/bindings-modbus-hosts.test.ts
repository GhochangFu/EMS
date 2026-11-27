import { describe, it } from "vitest";

import {
  assertAListedHostIsPlanned,
  assertAnEdgeServedRtuIsNotChecked,
  assertASecondOrganizationOnAPollEndpointIsSkipped,
  assertTwoOrganizationsShareAnMqttBroker,
  assertAnUnlistedHostIsSkippedByName,
  assertDifferentRequestSettingsOnOneGatewayConflict,
  assertMqttIsNotAffected,
  assertNoListDialsNothing,
} from "./bindings-modbus-hosts.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F1.2 — the cloud host dials only listed Modbus hosts (ADR 0141 decision 22)", () => {
  it("H1 a listed host or a host in a listed block is planned", () => assertAListedHostIsPlanned());
  it("H2 an unlisted host is skipped as modbus-host-not-allowed", () => assertAnUnlistedHostIsSkippedByName());
  it("H3 no list, or an empty one, dials nothing", () => assertNoListDialsNothing());
  it("H4 MQTT is not affected", () => assertMqttIsNotAffected());
  it("H5 an edge-served Modbus RTU is not checked against the cloud list", () => assertAnEdgeServedRtuIsNotChecked());
  it("H6 different request settings on one gateway skip the second RTU by name", () =>
    assertDifferentRequestSettingsOnOneGatewayConflict());
  it("H7 a second organization on a poll endpoint is skipped (ADR 0141 Amendment 2 (a))", () =>
    assertASecondOrganizationOnAPollEndpointIsSkipped());
  it("H8 two organizations still share an MQTT broker", () => assertTwoOrganizationsShareAnMqttBroker());
});
