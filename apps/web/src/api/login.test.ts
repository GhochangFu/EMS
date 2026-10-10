// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";

import {
  runALateMe401ForAnOldTokenRecordsNothing,
  runAMe401ForTheCurrentTokenRecordsTheReason,
  runAMe401WithAnEmptyStoreRecordsTheReason,
  runAMe401WithAnUnrelatedOlderTokenRecordsTheReason,
  runASessionSetDuringTheBodyReadRecordsNothing,
  runAStreamedBodyWithNoNewSessionRecordsTheReason,
  runAStoreChangedToTheRequestTokenRecordsTheReason,
  runRefreshScopeReplacesTheStoredScope,
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

describe("F4.214 fetchCurrentUser records a /me 401 reason only when the store did not change or holds the request's token", () => {
  it("M1 a session set mid-request: the late /me 401 records nothing and leaves the new session", async () => {
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

  it("M5 a /me 401 for B while the store holds an unchanged older token A records the reason", async () => {
    await runAMe401WithAnUnrelatedOlderTokenRecordsTheReason();
  });

  it("M6 a session set between the 401 headers and the body read records nothing", async () => {
    await runASessionSetDuringTheBodyReadRecordsNothing();
  });

  it("M6 control: the same streamed 401 body with no new session records the reason", async () => {
    await runAStreamedBodyWithNoNewSessionRecordsTheReason();
  });

  it("M7 a store that changed to the request's own token records the reason", async () => {
    await runAStoreChangedToTheRequestTokenRecordsTheReason();
  });
});

describe("F2.10 refreshScope", () => {
  it("R1 reads /me with the given token and replaces the stored scope (B8)", async () => {
    await runRefreshScopeReplacesTheStoredScope();
  });
});
