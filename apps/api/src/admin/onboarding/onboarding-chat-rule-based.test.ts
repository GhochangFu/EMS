import { describe, it } from "vitest";

import {
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
});
