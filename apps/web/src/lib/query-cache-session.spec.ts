import { QueryClient } from "@tanstack/react-query";

import { useAuthStore, type AuthUser } from "../stores/auth-store";
import { COPILOT_SESSION_KEY, useCopilotStore } from "../stores/copilot-store";
import { COPILOT_WINDOW_KEY, useCopilotWindowStore } from "../stores/copilot-window-store";
import { bindQueryCacheToSession, bindSessionStores } from "./query-cache-session";

/**
 * `F4.156` — the query cache belongs to one session.
 *
 * Driven through the real `useAuthStore` actions and a real `QueryClient`, so
 * the rule is proved against the transitions the app actually makes — not
 * against a fake store's idea of them.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const USER_A: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "a@bms.local",
  displayName: "User A",
  role: "admin",
};

const USER_B: AuthUser = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "b@bms.local",
  displayName: "User B",
  role: "viewer",
};

const KEY = ["assets"] as const;
const ROWS = [{ code: "CR-Q1" }];

/** Signs in as A, binds a fresh client, and seeds one cached query. */
function signedInAsA(): { client: QueryClient; unbind: () => void } {
  useAuthStore.getState().clearSession();
  useAuthStore.getState().setSession("token-a", USER_A, null, null);
  const client = new QueryClient();
  const unbind = bindQueryCacheToSession(useAuthStore, client);
  client.setQueryData(KEY, ROWS);
  assert(client.getQueryData(KEY) === ROWS, "fixture: the cache holds the seeded rows");
  return { client, unbind };
}

/** The session ending (access token becomes null) clears the cache. */
export function clearsWhenTheSessionEnds(): void {
  const { client, unbind } = signedInAsA();
  try {
    useAuthStore.getState().clearSession();
    assert(client.getQueryData(KEY) === undefined, "clearSession clears the query cache");
  } finally {
    unbind();
  }
}

/**
 * A different user in one `setSession` call clears the cache. A → B without a
 * `clearSession` between, so the session-ended branch cannot rescue this case.
 */
export function clearsWhenTheUserChanges(): void {
  const { client, unbind } = signedInAsA();
  try {
    useAuthStore.getState().setSession("token-b", USER_B, null, null);
    assert(client.getQueryData(KEY) === undefined, "a different user id clears the query cache");
  } finally {
    unbind();
  }
}

/**
 * The `/me` effect (`app.tsx`) re-sets the *same* token with a fresh user
 * object for the same id. That must not flush the app's cache. Positive
 * control after the absence: the binding is live, so `clearSession` clears.
 */
export function keepsTheCacheWhenMeResetsTheSameSession(): void {
  const { client, unbind } = signedInAsA();
  try {
    useAuthStore.getState().setSession("token-a", { ...USER_A }, null, null);
    assert(client.getQueryData(KEY) === ROWS, "same token, same user id keeps the cache");
    useAuthStore.getState().clearSession();
    assert(client.getQueryData(KEY) === undefined, "positive control: the binding is live");
  } finally {
    unbind();
  }
}

/**
 * A renewed access token for the same user must not flush the cache. No path
 * renews today (no OIDC silent refresh), so this pins the rule for the first
 * one that does. Positive control after the absence.
 */
export function keepsTheCacheWhenTheTokenIsRenewedForTheSameUser(): void {
  const { client, unbind } = signedInAsA();
  try {
    useAuthStore.getState().setSession("token-a-renewed", { ...USER_A }, null, null);
    assert(client.getQueryData(KEY) === ROWS, "a renewed token for the same user keeps the cache");
    useAuthStore.getState().clearSession();
    assert(client.getQueryData(KEY) === undefined, "positive control: the binding is live");
  } finally {
    unbind();
  }
}

/** A store change that is not a session change (`setScope`) keeps the cache. */
export function keepsTheCacheOnAnUnrelatedStoreChange(): void {
  const { client, unbind } = signedInAsA();
  try {
    useAuthStore
      .getState()
      .setScope({ kind: "global", locations: [], assetGroups: [], assetIds: [] });
    assert(client.getQueryData(KEY) === ROWS, "setScope keeps the cache");
    useAuthStore.getState().clearSession();
    assert(client.getQueryData(KEY) === undefined, "positive control: the binding is live");
  } finally {
    unbind();
  }
}

/** Signs in as A, binds both stores through `bindSessionStores`, and stores a copilot session. */
function copilotSessionOfA(): () => void {
  useAuthStore.getState().clearSession();
  useAuthStore.getState().setSession("token-a", USER_A, null, null);
  const unbind = bindSessionStores(useAuthStore, new QueryClient());
  useCopilotStore.getState().setConversation(USER_A.id, "33333333-3333-4333-8333-333333333333");
  assert(window.localStorage.getItem(COPILOT_SESSION_KEY) !== null, "fixture: the copilot session is stored");
  return unbind;
}

/**
 * `F4.244` (critique F1): the session ending removes the stored copilot
 * session — the one wiring `main.tsx` uses, gated here. Mutation: drop
 * `clearCopilotSession()` from `bindSessionStores`.
 */
export function theCopilotSessionIsClearedWhenTheSessionEnds(): void {
  const unbind = copilotSessionOfA();
  try {
    useAuthStore.getState().clearSession();
    assert(window.localStorage.getItem(COPILOT_SESSION_KEY) === null, "the session end removes the copilot key");
    assert(useCopilotStore.getState().conversationId === null, "the session end empties the copilot store");
  } finally {
    unbind();
  }
}

/**
 * `F4.292` (owner ruling P6): a logout (token set → null) removes the stored
 * window too. Mutation: remove the `clearCopilotWindow()` call from
 * `clearCopilotSession`.
 */
export function theCopilotWindowIsClearedWhenTheSessionEnds(): void {
  const unbind = copilotSessionOfA();
  try {
    useCopilotWindowStore.getState().setOpen(true);
    assert(window.localStorage.getItem(COPILOT_WINDOW_KEY) !== null, "fixture: the copilot window is stored");
    useAuthStore.getState().clearSession();
    assert(window.localStorage.getItem(COPILOT_WINDOW_KEY) === null, "the session end removes the copilot window key");
  } finally {
    unbind();
  }
}

/** The adjacent positive: a renewal for the same user keeps the copilot session. */
export function theCopilotSessionSurvivesASameUserRenewal(): void {
  const unbind = copilotSessionOfA();
  try {
    useAuthStore.getState().setSession("token-a-renewed", { ...USER_A }, null, null);
    assert(window.localStorage.getItem(COPILOT_SESSION_KEY) !== null, "a same-user renewal keeps the copilot key");
  } finally {
    unbind();
  }
}

const CONVERSATION = "33333333-3333-4333-8333-333333333333";

/**
 * Signed out and bound, with a copilot session of A stored meanwhile — the
 * key another tab of A, still signed in, wrote back after this tab's clear.
 */
function signedOutWithAStoredSessionOfA(): () => void {
  useAuthStore.getState().clearSession();
  const unbind = bindSessionStores(useAuthStore, new QueryClient());
  useCopilotStore.getState().setConversation(USER_A.id, CONVERSATION);
  assert(window.localStorage.getItem(COPILOT_SESSION_KEY) !== null, "fixture: the copilot session of A is stored");
  return unbind;
}

/**
 * `F4.244` (security L1): a sign-in from signed out as B finds A's stored
 * session and clears it. Neither transition rule of `sessionChanged` fires on
 * null → B. Mutation: drop the owner check from the auth subscription.
 */
export function aSignInAsAnotherUserClearsAStoredCopilotSession(): void {
  const unbind = signedOutWithAStoredSessionOfA();
  try {
    useAuthStore.getState().setSession("token-b", USER_B, null, null);
    assert(window.localStorage.getItem(COPILOT_SESSION_KEY) === null, "a sign-in as B removes A's copilot key");
  } finally {
    unbind();
  }
}

/** The adjacent positive: a sign-in from signed out as A keeps A's stored session. Mutation: clear on any sign-in. */
export function aSignInAsTheSameUserKeepsTheStoredCopilotSession(): void {
  const unbind = signedOutWithAStoredSessionOfA();
  try {
    useAuthStore.getState().setSession("token-a", USER_A, null, null);
    assert(window.localStorage.getItem(COPILOT_SESSION_KEY) !== null, "a sign-in as A keeps A's copilot key");
  } finally {
    unbind();
  }
}

/** Signed in as B, unbound, with a copilot session of A in the store and the key (a reload of B's tab). */
function signedInAsBWithAStoredSessionOfA(): void {
  useAuthStore.getState().clearSession();
  useAuthStore.getState().setSession("token-b", USER_B, null, null);
  useCopilotStore.getState().setConversation(USER_A.id, CONVERSATION);
  assert(window.localStorage.getItem(COPILOT_SESSION_KEY) !== null, "fixture: the copilot session of A is stored");
}

/** The state at bind time counts too: a reload signed in as B clears A's key. Mutation: drop the bind-time check. */
export function aStoredCopilotSessionOfAnotherUserIsClearedAtBind(): void {
  signedInAsBWithAStoredSessionOfA();
  const unbind = bindSessionStores(useAuthStore, new QueryClient());
  try {
    assert(window.localStorage.getItem(COPILOT_SESSION_KEY) === null, "the bind removes another user's copilot key");
  } finally {
    unbind();
  }
}

/**
 * A rehydrate that reads another user's key clears it too. The key is
 * written straight into `localStorage`, as another tab does. Mutation: drop
 * the `onFinishHydration` check.
 */
export async function aRehydratedCopilotSessionOfAnotherUserIsCleared(): Promise<void> {
  useAuthStore.getState().clearSession();
  useAuthStore.getState().setSession("token-b", USER_B, null, null);
  const unbind = bindSessionStores(useAuthStore, new QueryClient());
  try {
    window.localStorage.setItem(
      COPILOT_SESSION_KEY,
      JSON.stringify({ state: { userId: USER_A.id, organizationId: "", conversationId: CONVERSATION }, version: 0 }),
    );
    await useCopilotStore.persist.rehydrate();
    assert(window.localStorage.getItem(COPILOT_SESSION_KEY) === null, "a rehydrate of another user's key removes it");
    assert(useCopilotStore.getState().conversationId === null, "a rehydrate of another user's key empties the store");
  } finally {
    unbind();
  }
}
