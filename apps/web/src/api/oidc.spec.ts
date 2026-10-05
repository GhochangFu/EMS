import { expect, vi } from "vitest";

import { completeOidcLogin } from "./oidc";

/**
 * `F4.210` — the OIDC callback validates `state` before it reads the IdP's
 * `error`, and never renders `error_description`.
 *
 * Assertions live here; `oidc.test.ts` is the Vitest entry point (ADR 0014).
 * `fetch` rejects in every case, so no token exchange leaves the process.
 */

const STATE_KEY = "bms-oidc-state";
const VERIFIER_KEY = "bms-oidc-code-verifier";
const ATTACKER = "ATTACKER-TEXT";

/** The message `completeOidcLogin` throws for `search`, with `stored` as the kept state. */
async function expectRejection(search: string, stored = "good"): Promise<string> {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("oidc.spec: no fetch expected"))),
  );
  sessionStorage.setItem(STATE_KEY, stored);
  sessionStorage.setItem(VERIFIER_KEY, "verifier");
  try {
    await completeOidcLogin(search);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("oidc.spec: completeOidcLogin resolved");
}

/** S1 — an `error` with a wrong `state` throws the state sentence, not the attacker's text. */
export async function anErrorWithAWrongStateThrowsTheStateSentence(): Promise<void> {
  const message = await expectRejection(
    `?error=access_denied&error_description=${ATTACKER}&state=wrong`,
  );
  expect(message).toBe("OIDC callback state is invalid");
  expect(message).not.toContain(ATTACKER);
}

/** S2 — an allowlisted `error` with a valid `state` reads as the fixed sentence with the code. */
export async function anAllowlistedErrorReadsAsTheFixedSentence(): Promise<void> {
  const message = await expectRejection(
    `?error=access_denied&error_description=${ATTACKER}&state=good`,
  );
  expect(message).toBe("Keycloak refused the sign-in (access_denied).");
}

/** S3 — a code outside the allowlist is not echoed. */
export async function aNonAllowlistedErrorIsNotEchoed(): Promise<void> {
  const message = await expectRejection(
    `?error=${encodeURIComponent("<script>x")}&state=good`,
  );
  expect(message).toBe("Keycloak refused the sign-in.");
}

/** S4 — control: no `error`, a valid `state` and no `code` still throws the state sentence. */
export async function noCodeWithAValidStateThrowsTheStateSentence(): Promise<void> {
  expect(await expectRejection("?state=good")).toBe("OIDC callback state is invalid");
}

/** S5 — an IdP error with a valid `state` still removes both one-time keys. */
export async function anIdpErrorRemovesBothSessionKeys(): Promise<void> {
  await expectRejection("?error=access_denied&state=good");
  expect(sessionStorage.getItem(STATE_KEY)).toBeNull();
  expect(sessionStorage.getItem(VERIFIER_KEY)).toBeNull();
}
