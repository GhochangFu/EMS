import { describe, it } from "vitest";

import {
  assertAddRtuAcceptsAnEmptyMqttTopic,
  assertAddRtuAcceptsAnOrdinaryMqttTopic,
  assertAddRtuRefusesAStringPort,
  assertAddRtuRefusesAnInvalidMqttConfigAndLeavesTheDraft,
  assertAnMqttActionLineHasNoConfigOnlyTail,
  assertAnUnwiredProtocolIsConfigOnlyInTheActionLine,
  assertListProtocolsReturnsTheCatalogWithFields,
  assertTheCredentialedFreezeRunsBeforeTheConfigCheck,
  assertTheToolCountStaysTwentyNine,
  assertUpdateRtuAcceptsAValidPort,
  assertUpdateRtuChecksAgainstThePatchedProtocol,
  assertUpdateRtuRefusesAnInvalidMergedConfigAndLeavesTheDraft,
  assertUpdateRtuToAnUnwiredProtocolIsConfigOnly,
} from "./onboarding-protocol-tools.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("the RTU tools and the protocol catalog (F3.24a, ADR 0093 decisions 5, 6)", () => {
  it("add_rtu refuses an invalid MQTT config and leaves the draft", async () => {
    await assertAddRtuRefusesAnInvalidMqttConfigAndLeavesTheDraft();
  });

  it("add_rtu accepts an ordinary MQTT topic", async () => {
    await assertAddRtuAcceptsAnOrdinaryMqttTopic();
  });

  it("add_rtu refuses a string port", async () => {
    await assertAddRtuRefusesAStringPort();
  });

  it("add_rtu accepts the guided empty MQTT topic", async () => {
    await assertAddRtuAcceptsAnEmptyMqttTopic();
  });

  it("an unwired protocol is config only in the action line", async () => {
    await assertAnUnwiredProtocolIsConfigOnlyInTheActionLine();
  });

  it("an MQTT action line has no config-only tail", async () => {
    await assertAnMqttActionLineHasNoConfigOnlyTail();
  });

  it("update_rtu refuses an invalid merged config and leaves the draft", async () => {
    await assertUpdateRtuRefusesAnInvalidMergedConfigAndLeavesTheDraft();
  });

  it("update_rtu accepts a valid port", async () => {
    await assertUpdateRtuAcceptsAValidPort();
  });

  it("update_rtu checks the merged config against the patched protocol", async () => {
    await assertUpdateRtuChecksAgainstThePatchedProtocol();
  });

  it("update_rtu to an unwired protocol is config only", async () => {
    await assertUpdateRtuToAnUnwiredProtocolIsConfigOnly();
  });

  it("the credentialed freeze runs before the config check", async () => {
    await assertTheCredentialedFreezeRunsBeforeTheConfigCheck();
  });

  it("list_protocols returns the catalog with its fields", async () => {
    await assertListProtocolsReturnsTheCatalogWithFields();
  });

  it("the tool count stays 29", () => {
    assertTheToolCountStaysTwentyNine();
  });
});
