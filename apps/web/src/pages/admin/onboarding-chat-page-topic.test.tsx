// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aModbusRtuHasNoTopicField,
  aRefusedTopicSaveShowsTheReason,
  theSavedTopicReachesTheSummary,
  theTopicFieldIsBoundedAt255,
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
});
