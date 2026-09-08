import { describe, it } from "vitest";

import {
  assertAssetsBranchStaysUnderItsCeiling,
  assertAssetsByRtuSummaryIsCapped,
  assertDisplayNameFixListIsCapped,
  assertEchoedItemsHelpersAreBounded,
  assertMqttTemplateBlocksAreCapped,
  assertMqttTemplateKeepsTheRtusItsProseCounts,
  assertPointKeyPreviewIsCapped,
  assertShippedTemplateElidesNothing,
  assertSummaryTailsCarryNothingButACount,
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

  // The cap must not drop the RTUs the prose above it counts — the template's
  // filter is wider than `mqttIncomplete`, so a leading cut alone can elide the
  // only RTU the message is about.
  it("sorts the RTUs that still need setup to the front of the capped template", () => {
    assertMqttTemplateKeepsTheRtusItsProseCounts();
  });

  it("caps the RTU lines and spends one asset budget across the whole summary", () => {
    assertAssetsByRtuSummaryIsCapped();
  });

  // Sections 5 and 6 of the case above, split out for the same reason: behind
  // one `it()` they sat after assertions that every cap mutation reddens first,
  // so no mutation ever reached them and they gated nothing.
  it("puts a count and its unit in every tail, and nothing from the data", () => {
    assertSummaryTailsCarryNothingButACount();
  });

  it("keeps the whole assets branch under its length ceiling", () => {
    assertAssetsBranchStaysUnderItsCeiling();
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
