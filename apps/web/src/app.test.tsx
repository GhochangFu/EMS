// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "./stores/auth-store";
import {
  aDeactivatedMeOnLoadRecordsTheReason,
  aDeactivatedMeOnLoadShowsTheSentence,
  aPlainMeOnLoadShowsNothing,
  aRefusedMeOnAWallUrlKeepsTheReturnPath,
  anExpiredTokenOnAWallUrlKeepsTheReturnPath,
  aViewerReachesTheAttributionsPage,
  theMeEffectKeepsTheStoredIdToken,
} from "./app.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F4.156 App /me effect", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useAuthStore.getState().clearSession();
    localStorage.clear();
  });

  it("M1 keeps the stored OIDC id token when /me re-sets the session", async () => {
    await theMeEffectKeepsTheStoredIdToken();
  });

  it("A1 a signed-in viewer reaches /attributions", async () => {
    await aViewerReachesTheAttributionsPage();
  });
});

describe("F3.77 D10 App session effects keep a wall URL", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useAuthStore.getState().clearSession();
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("R1 keeps the wall URL as the return path when the stored token has expired", async () => {
    await anExpiredTokenOnAWallUrlKeepsTheReturnPath();
  });

  it("R2 keeps the wall URL as the return path when /me refuses the token", async () => {
    await aRefusedMeOnAWallUrlKeepsTheReturnPath();
  });
});

describe("F4.203 a deactivated /me on load (OQ2)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useAuthStore.getState().clearSession();
    // `clearSession` keeps the reason by design; the next case must start without it.
    useAuthStore.setState({ authFailureReason: null });
    localStorage.clear();
  });

  it("D1 a deactivated /me 401 records the reason", async () => {
    await aDeactivatedMeOnLoadRecordsTheReason();
  });

  it("D2 the sign-in page then shows the deactivated sentence", async () => {
    await aDeactivatedMeOnLoadShowsTheSentence();
  });

  it("D3 a plain /me 401 shows nothing", async () => {
    await aPlainMeOnLoadShowsNothing();
  });
});
