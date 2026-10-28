// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aReloadResumesTheStoredConversation,
  clearingRemovesTheStoredKey,
  openingAListedChatSetsItsPick,
  theOnboardingRequestIsNotStored,
  theStoredKeysAreTheSessionOnly,
} from "./copilot-store.spec";
import { resetCopilotStore } from "./copilot-store";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), one claim per `it()`. */
describe("F4.244 copilot store — the persisted session", () => {
  afterEach(() => {
    resetCopilotStore();
    window.localStorage.clear();
  });

  it("stores the user, the pick and the conversation, and nothing else", () => theStoredKeysAreTheSessionOnly());
  it("keeps the onboarding request out of storage", () => theOnboardingRequestIsNotStored());
  it("resumes the stored conversation after a reload", () => aReloadResumesTheStoredConversation());
  it("removes the stored key when the session is cleared", () => clearingRemovesTheStoredKey());
  it("opens a listed chat with its pick (F4.292)", () => openingAListedChatSetsItsPick());
});
