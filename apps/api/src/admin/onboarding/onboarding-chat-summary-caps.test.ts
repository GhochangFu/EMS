import { describe, it } from "vitest";

import {
  assertDisplayNameFixListIsCapped,
  assertEchoedItemsHelpersAreBounded,
  assertMqttTemplateBlocksAreCapped,
} from "./onboarding-chat-summary-caps.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("onboarding import summary — how many items it may echo (F4.105)", () => {
  it("shows a bounded prefix and states the omitted count, and nothing else", () => {
    assertEchoedItemsHelpersAreBounded();
  });

  it("caps the display-name fix list and says how many it left out", () => {
    assertDisplayNameFixListIsCapped();
  });

  it("caps the MQTT paste-back blocks, with the tail outside the copy markers", () => {
    assertMqttTemplateBlocksAreCapped();
  });
});
