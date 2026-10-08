// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aLegacyTopicFillsTheField,
  aModbusRtuHasNoTopicField,
  anAbsentTopicShowsEmptyNotADash,
  anEmptyTopicBesideALegacyKeyShowsEmpty,
  aWhitespaceTopicIsShownAsSent,
  saveIsDisabledWhenTheEditEqualsTheLegacyTopic,
  theTopicKeyWinsInTheField,
  theSaveOverALegacyKeyDropsIt,
  theSaveOverALegacyKeySendsTheTopic,
  theSaveOverAStoredTopicSendsTheTypedOne,
  theSameTopicOverAShadowedKeyDropsIt,
  theSameTopicOverAShadowedKeyKeepsTheTopic,
  aRefusedTopicSaveShowsTheReason,
  theSavedTopicReachesTheSummary,
  theTopicFieldIsBoundedAt255,
  theTopicSaveWaitsForAChatTurn,
  theTopicSaveWaitsForACredentialSave,
  theTopicSaveKeepsTheRestOfTheConfig,
  theTopicSaveSendsTheTopic,
} from "./onboarding-chat-page-topic.spec";
import { restoreScrolling } from "./onboarding-chat-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); the
 * jsdom docblock is on this file because Vitest reads it from the file it
 * collects (ADR 0042 decision 2). One `it()` per claim.
 */
describe("F4.208 the Topic field beside an MQTT RTU's credentials", () => {
  // The same budget as `onboarding-chat-page.test.tsx`: a banner that never
  // appears must fail on its own assertion, not on Vitest's timeout.
  vi.setConfig({ testTimeout: 15_000 });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreScrolling();
  });

  it("W1: the save sends the typed topic", async () => {
    await theTopicSaveSendsTheTopic();
  });

  it("W2: the save keeps the rest of the RTU's config", async () => {
    await theTopicSaveKeepsTheRestOfTheConfig();
  });

  it("W3: the saved topic reaches the Summary", async () => {
    await theSavedTopicReachesTheSummary();
  });

  it("W4: a refused save shows the server's sentence", async () => {
    await aRefusedTopicSaveShowsTheReason();
  });

  it("W5: the field is bounded at 255 characters", async () => {
    await theTopicFieldIsBoundedAt255();
  });

  it("W6: a Modbus RTU has no Topic field", async () => {
    await aModbusRtuHasNoTopicField();
  });

  it("W7: Save topic is disabled while a chat turn is in flight", async () => {
    await theTopicSaveWaitsForAChatTurn();
  });

  it("W8: Save topic is disabled while a credentials save is in flight", async () => {
    await theTopicSaveWaitsForACredentialSave();
  });

  it("E1: a legacy mqttTopic fills the field", async () => {
    await aLegacyTopicFillsTheField();
  });

  it("E2: the topic key wins in the field", async () => {
    await theTopicKeyWinsInTheField();
  });

  it("E3: an empty topic beside a legacy key shows empty", async () => {
    await anEmptyTopicBesideALegacyKeyShowsEmpty();
  });

  it("E4: an absent topic shows empty, not a dash", async () => {
    await anAbsentTopicShowsEmptyNotADash();
  });

  it("E5: a whitespace topic is shown as sent", async () => {
    await aWhitespaceTopicIsShownAsSent();
  });

  it("E6: Save topic is disabled when the edit equals the legacy topic", async () => {
    await saveIsDisabledWhenTheEditEqualsTheLegacyTopic();
  });

  it("E7a: Save over a legacy key sends the typed topic", async () => {
    await theSaveOverALegacyKeySendsTheTopic();
  });

  it("E7b: Save over a legacy key drops the legacy mqttTopic", async () => {
    await theSaveOverALegacyKeyDropsIt();
  });

  it("E8: Save over a stored topic sends the typed one", async () => {
    await theSaveOverAStoredTopicSendsTheTypedOne();
  });

  it("E9a: re-saving the same topic over a shadowed mqttTopic drops it", async () => {
    await theSameTopicOverAShadowedKeyDropsIt();
  });

  it("E9b: that save still sends the kept topic", async () => {
    await theSameTopicOverAShadowedKeyKeepsTheTopic();
  });
});
