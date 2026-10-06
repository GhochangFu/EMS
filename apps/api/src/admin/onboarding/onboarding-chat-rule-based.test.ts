import { describe, it } from "vitest";

import {
  assertAnEmbeddedProtocolWordFallsBackToMqtt,
  assertAProtocolFormIsDetected,
  assertAConfirmStepAnswersThroughFinalizeWithNoPatch,
  assertAMqttMessageCarriesItsTopicIntoTheConfig,
  assertANamedProtocolAppendsAnRtuWithItsDefaultConfig,
} from "./onboarding-chat-rule-based.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("the guided onboarding mode, as a module (F4.217)", () => {
  it("appends an RTU with the protocol's default config", async () => {
    await assertANamedProtocolAppendsAnRtuWithItsDefaultConfig();
  });

  it("carries a typed MQTT topic into the config", async () => {
    await assertAMqttMessageCarriesItsTopicIntoTheConfig();
  });

  it("answers a confirm step through finalizeTurn with an empty patch", async () => {
    await assertAConfirmStepAnswersThroughFinalizeWithNoPatch();
  });

  it("falls back to MQTT for a word that only contains a protocol word", async () => {
    await assertAnEmbeddedProtocolWordFallsBackToMqtt();
  });

  it.each([
    ["OPC-UA", "opc_ua"],
    ["opc_ua", "opc_ua"],
    ["opcua", "opc_ua"],
    ["REST", "rest_poller"],
    ["rest poller", "rest_poller"],
    ["rest_poller", "rest_poller"],
    ["Simulator", "simulator"],
    ["simulator", "simulator"],
    ["sim", "simulator"],
    ["modbus_tcp", "modbus_tcp"],
    ["Modbus TCP", "modbus_tcp"],
    ["BACnet", "bacnet"],
    ["bacnet/ip", "bacnet"],
    ["SNMP", "snmp"],
    ["MQTTS", "mqtt"],
  ])("detects the form %s as %s", async (word, protocol) => {
    await assertAProtocolFormIsDetected(word, protocol);
  });
});
