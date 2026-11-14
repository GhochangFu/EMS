// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../../stores/auth-store";
import { resetCopilotStore } from "../../stores/copilot-store";
import {
  aCapTurnShowsTheMessageAndTheCause,
  aFailedRequestRestoresTheText,
  aFailedTurnThatStoredNothingRestoresTheText,
  aRefusalBeforeTheCredentialCheckDoesNotRestore,
} from "./copilot-dock-failed-turn.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({ scope: null });
  resetCopilotStore();
  window.localStorage.clear();
});

/** `F4.360` defect 2 — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.360 copilot dock — a failed turn keeps the user's message", () => {
  it("shows the stored message and cause of a cap turn", aCapTurnShowsTheMessageAndTheCause);
  it("puts the text back after a failed turn that stored nothing", aFailedTurnThatStoredNothingRestoresTheText);
  it("puts the text back after a failed request", aFailedRequestRestoresTheText);
  it("does not put the text back after a refusal before the credential check", aRefusalBeforeTheCredentialCheckDoesNotRestore);
});
