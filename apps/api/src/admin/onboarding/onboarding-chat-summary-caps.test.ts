import { describe, it } from "vitest";

import { assertEchoedItemsHelpersAreBounded } from "./onboarding-chat-summary-caps.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("onboarding import summary — how many items it may echo (F4.105)", () => {
  it("shows a bounded prefix and states the omitted count, and nothing else", () => {
    assertEchoedItemsHelpersAreBounded();
  });
});
