// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFailedTemplateDownloadShowsTheReason,
  aFailedUploadReachesTheChatBanner,
  aFailedValidateShowsSomethingAtAll,
  aRefusedChatTurnShowsTheServersSentence,
  aRefusedCommitShowsTheReason,
  aRefusedCredentialSaveShowsTheReason,
  aRefusedStartShowsASentenceNotAZodFlatten,
  restoreScrolling,
} from "./onboarding-chat-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest reads
 * it from the file it collects (ADR 0042 decision 2).
 *
 * One `it()` per claim, so a mutation reddens exactly the case it belongs to.
 * A single case covering several surfaces hides the ones a mutation never
 * reaches — the failure `F4.105` recorded.
 */
describe("F4.106 onboarding chat page error surfaces", () => {
  // `test-setup.ts` sets testing-library's `asyncUtilTimeout` to 5000 ms, which
  // is exactly Vitest's default `testTimeout` — so a case whose banner never
  // appears loses the race and reports "Test timed out", naming no assertion at
  // all. This row's whole discipline is reading WHICH assertion a mutation
  // reddens, so the budget has to sit above the wait it contains.
  vi.setConfig({ testTimeout: 15_000 });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // A prototype assignment is not a spy, so the line above does not undo it.
    restoreScrolling();
  });

  it("shows a sentence, not a Zod flatten, when the session cannot start", async () => {
    await aRefusedStartShowsASentenceNotAZodFlatten();
  });

  it("shows the server's sentence when a chat turn is refused", async () => {
    await aRefusedChatTurnShowsTheServersSentence();
  });

  it("shows the reason when a commit is refused", async () => {
    await aRefusedCommitShowsTheReason();
  });

  it("shows the reason when a credential save is refused", async () => {
    await aRefusedCredentialSaveShowsTheReason();
  });

  it("shows something at all when a validation request fails", async () => {
    await aFailedValidateShowsSomethingAtAll();
  });

  it("shows a failed Excel upload in the chat banner", async () => {
    await aFailedUploadReachesTheChatBanner();
  });

  it("shows the reason when the template download is refused", async () => {
    await aFailedTemplateDownloadShowsTheReason();
  });
});
