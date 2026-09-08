import { describe, it } from "vitest";

import {
  assertAssetsByRtuSummaryIsCapped,
  assertDisplayNameFixListIsCapped,
  assertEchoedItemsHelpersAreBounded,
  assertMqttTemplateBlocksAreCapped,
  assertPointKeyPreviewIsCapped,
  assertShippedTemplateElidesNothing,
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

  it("caps the RTU lines and spends one asset budget across the whole summary", () => {
    assertAssetsByRtuSummaryIsCapped();
  });

  // Its own case, not one more assertion inside the one above. It is an
  // absence assertion, and folding it in put it behind assertions that the
  // `MAX_ECHOED_ITEMS = 2` mutation reddens first — so the mutation never
  // reached it and it passed for free.
  it("elides nothing at all from the shipped template's own import", () => {
    assertShippedTemplateElidesNothing();
  });

  it("previews the organisation's point keys against the same bound (owner ruling 5)", () => {
    assertPointKeyPreviewIsCapped();
  });
});
