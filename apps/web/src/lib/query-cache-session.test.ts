// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import { resetCopilotStore } from "../stores/copilot-store";
import {
  aRehydratedCopilotSessionOfAnotherUserIsCleared,
  aSignInAsAnotherUserClearsAStoredCopilotSession,
  aSignInAsTheSameUserKeepsTheStoredCopilotSession,
  aStoredCopilotSessionOfAnotherUserIsClearedAtBind,
  clearsWhenTheSessionEnds,
  clearsWhenTheUserChanges,
  keepsTheCacheOnAnUnrelatedStoreChange,
  keepsTheCacheWhenMeResetsTheSameSession,
  keepsTheCacheWhenTheTokenIsRenewedForTheSameUser,
  theCopilotSessionIsClearedWhenTheSessionEnds,
  theCopilotSessionSurvivesASameUserRenewal,
  theCopilotWindowIsClearedWhenTheSessionEnds,
} from "./query-cache-session.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * jsdom because `useAuthStore` persists to `localStorage`.
 */
describe("F4.156 query cache bound to the session", () => {
  // `F4.244`: the copilot cases store a session; none may reach the next case.
  afterEach(() => {
    resetCopilotStore();
  });

  it("clears the cache when the session ends", () => {
    clearsWhenTheSessionEnds();
  });

  it("clears the cache when the user changes", () => {
    clearsWhenTheUserChanges();
  });

  it("keeps the cache when /me re-sets the same session", () => {
    keepsTheCacheWhenMeResetsTheSameSession();
  });

  it("keeps the cache when the token is renewed for the same user", () => {
    keepsTheCacheWhenTheTokenIsRenewedForTheSameUser();
  });

  it("keeps the cache on an unrelated store change", () => {
    keepsTheCacheOnAnUnrelatedStoreChange();
  });

  it("F4.244: clears the stored copilot session when the session ends", () => {
    theCopilotSessionIsClearedWhenTheSessionEnds();
  });

  it("F4.292: clears the stored copilot window when the session ends", () => {
    theCopilotWindowIsClearedWhenTheSessionEnds();
  });

  it("F4.244: keeps the stored copilot session on a same-user renewal", () => {
    theCopilotSessionSurvivesASameUserRenewal();
  });

  it("F4.244: a sign-in as another user clears a stored copilot session", () => {
    aSignInAsAnotherUserClearsAStoredCopilotSession();
  });

  it("F4.244: a sign-in as the same user keeps the stored copilot session", () => {
    aSignInAsTheSameUserKeepsTheStoredCopilotSession();
  });

  it("F4.244: the bind clears a stored copilot session of another user", () => {
    aStoredCopilotSessionOfAnotherUserIsClearedAtBind();
  });

  it("F4.244: a rehydrate clears a stored copilot session of another user", async () => {
    await aRehydratedCopilotSessionOfAnotherUserIsCleared();
  });
});
