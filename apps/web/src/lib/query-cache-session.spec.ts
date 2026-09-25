import { QueryClient } from "@tanstack/react-query";

import { useAuthStore, type AuthUser } from "../stores/auth-store";
import { bindQueryCacheToSession } from "./query-cache-session";

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
