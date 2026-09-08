import { describe, it } from "vitest";

import {
  assertAssetsByRtuSummaryIsIndexedNotRescanned,
  assertExcelImportFollowUpBoundsEchoedText,
  assertRuleBasedTurnBoundsDerivedDraftStrings,
  assertRuleBasedTurnBoundsMqttTopic,
  assertRuleBasedTurnCutsWholeCharacters,
} from "./onboarding-chat.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("OnboardingChatService.excelImportFollowUp (F4.102)", () => {
  it("bounds every cell it echoes from the imported sheet", () => {
    assertExcelImportFollowUpBoundsEchoedText();
  });

  it(
    "indexes the assets by RTU instead of rescanning them per RTU",
    () => {
      assertAssetsByRtuSummaryIsIndexedNotRescanned();
    },
    // 10,050 RTUs and 10,050 assets. The quadratic version this replaced took
    // ~2 s, and a contended full-suite run breaches the 5 s vitest default
    // while the assertion itself is still the thing being measured.
    60_000,
  );
});

/**
 * The branch that runs when `OPENAI_API_KEY` is empty, which is what
 * `.env.example` ships — the draft's default producer, and the one that parses
 * no schema.
 */
describe("OnboardingChatService.handleTurn, rule-based branch (F4.104)", () => {
  it("bounds every draft string it derives, against the schema itself", async () => {
    await assertRuleBasedTurnBoundsDerivedDraftStrings();
  });

  it("bounds the MQTT topic it lifts out of the message", async () => {
    await assertRuleBasedTurnBoundsMqttTopic();
  });

  it("cuts on whole characters, so the draft it writes is valid jsonb", async () => {
    await assertRuleBasedTurnCutsWholeCharacters();
  });
});
