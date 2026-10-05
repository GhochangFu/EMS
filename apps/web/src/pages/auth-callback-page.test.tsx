// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aDeactivatedCallbackShowsTheSentence,
  aPlainRefusedCallbackKeepsItsMessage,
  navigatesToTheReturnPath,
  navigatesToTheRootWithoutAReturnPath,
  readsTheWaitingSentence,
} from "./auth-callback-page.spec";
import { useAuthStore } from "../stores/auth-store";

/**
 * `F3.33` U5 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.localStorage.clear();
  useAuthStore.getState().clearSession();
  // `clearSession` keeps the reason by design; the next case must start without it.
  useAuthStore.setState({ authFailureReason: null });
});

describe("F3.33 the auth callback names IONSiTE NEXUS", () => {
  it("A1 reads the waiting sentence", () => {
    readsTheWaitingSentence();
  });
});

describe("F3.77 the auth callback returns to the kept wall URL", () => {
  it("A2 a completed callback lands on the stored return path with replace", async () => {
    await navigatesToTheReturnPath();
  });

  it("A3 a completed callback with no return path lands on / with replace", async () => {
    await navigatesToTheRootWithoutAReturnPath();
  });
});

describe("F4.203 the auth callback for a deactivated account", () => {
  it("A4 shows the deactivated sentence", async () => {
    await aDeactivatedCallbackShowsTheSentence();
  });

  it("A5 a plain 401 keeps 'Current user failed (401)'", async () => {
    await aPlainRefusedCallbackKeepsItsMessage();
  });
});
