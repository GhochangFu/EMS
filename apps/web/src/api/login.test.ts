// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";

import {
  runALateMe401ForAnOldTokenRecordsNothing,
  runAMe401ForTheCurrentTokenRecordsTheReason,
  runAMe401WithAnEmptyStoreRecordsTheReason,
  runTheRequestCarriesTheTokenItWasGiven,
} from "./login.spec";
import { useAuthStore } from "../stores/auth-store";

/**
 * Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014).
 * jsdom: the auth store's persist middleware wants storage.
 */
afterEach(() => {
  useAuthStore.setState({
    accessToken: null,
    user: null,
    scope: null,
    oidcIdToken: null,
    authFailureReason: null,
  });
  vi.unstubAllGlobals();
});

describe("F4.214 fetchCurrentUser records a /me 401 reason only for the current or an empty session", () => {
  it("M1 a late /me 401 for an old token records nothing and leaves the new session", async () => {
    await runALateMe401ForAnOldTokenRecordsNothing();
  });

  it("M2 control: a /me 401 with an empty store records the reason", async () => {
    await runAMe401WithAnEmptyStoreRecordsTheReason();
  });

  it("M3 control: a /me 401 for the current token records the reason", async () => {
    await runAMe401ForTheCurrentTokenRecordsTheReason();
  });

  it("M4 /me carries the token it was given", async () => {
    await runTheRequestCarriesTheTokenItWasGiven();
  });
});
