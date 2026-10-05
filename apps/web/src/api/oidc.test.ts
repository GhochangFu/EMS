// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";

import {
  anIdpErrorRemovesBothSessionKeys,
  aNonAllowlistedErrorIsNotEchoed,
  anAllowlistedErrorReadsAsTheFixedSentence,
  anErrorWithAWrongStateThrowsTheStateSentence,
  noCodeWithAValidStateThrowsTheStateSentence,
} from "./oidc.spec";

/**
 * `F4.210` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); jsdom because
 * `completeOidcLogin` reads `sessionStorage`.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("F4.210 the OIDC callback validates state before it reads the IdP error", () => {
  it("S1 an error with a wrong state throws the state sentence, not the attacker's text", async () => {
    await anErrorWithAWrongStateThrowsTheStateSentence();
  });

  it("S2 an allowlisted error with a valid state reads as the fixed sentence with the code", async () => {
    await anAllowlistedErrorReadsAsTheFixedSentence();
  });

  it("S3 a non-allowlisted error code is not echoed", async () => {
    await aNonAllowlistedErrorIsNotEchoed();
  });

  it("S4 no error, a valid state and no code still throws the state sentence", async () => {
    await noCodeWithAValidStateThrowsTheStateSentence();
  });

  it("S5 an IdP error with a valid state removes both one-time session keys", async () => {
    await anIdpErrorRemovesBothSessionKeys();
  });
});
