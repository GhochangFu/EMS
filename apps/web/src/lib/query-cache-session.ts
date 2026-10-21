/**
 * `F4.156` — the query cache belongs to one session.
 *
 * Only `handleLogout` used to call `queryClient.clear()`. Three other exits
 * end the session and kept the cache: the 401 handler
 * (`api/http.ts` `clearSessionOnAuthFailure`), the JWT-expiry effect and the
 * `/me` failure in `app.tsx`. `LoginPage` then signs the next user in without
 * a reload, so that user inherited the previous user's cached reads — the
 * Control Room decision among them, which `["assets"]` holds for five minutes.
 *
 * One subscription, bound where the `QueryClient` is created (`main.tsx`),
 * clears the cache on either transition:
 *
 * - **the session ends** — the access token goes from set to null;
 * - **the identity changes** — both states hold a user and the ids differ.
 *
 * It does **not** clear when the token is re-set or renewed for the same user
 * id: the `/me` effect in `app.tsx` re-sets the same token with a fresh user
 * object whenever `scope` is null, and a clear there would flush the whole
 * app's cache for nothing. Both rules are transitions on `(state, prev)`, not
 * "the token is null now", so a later write while signed out does not clear
 * again.
 *
 * `F4.244`: the copilot session (`bms-copilot-session`, persisted since the
 * owner ruling of 2026-10-20) belongs to the session too. {@link bindSessionStores}
 * clears it on the same transitions, so every exit above removes the key with
 * no code of its own; `main.tsx` binds through it.
 */

import { clearCopilotSession } from "../stores/copilot-store";

type SessionState = {
  readonly accessToken: string | null;
  readonly user: { readonly id: string } | null;
};

type SessionStore<S extends SessionState> = {
  subscribe(listener: (state: S, prev: S) => void): () => void;
};

/** True when the `prev` → `state` transition starts a different session. */
export function sessionChanged(state: SessionState, prev: SessionState): boolean {
  if (prev.accessToken !== null && state.accessToken === null) {
    return true;
  }
  return prev.user !== null && state.user !== null && prev.user.id !== state.user.id;
}

/** Clears `client` on every session change of `store`; returns the unsubscribe. */
export function bindQueryCacheToSession<S extends SessionState>(
  store: SessionStore<S>,
  client: { clear(): void },
): () => void {
  return store.subscribe((state, prev) => {
    if (sessionChanged(state, prev)) {
      client.clear();
    }
  });
}

/**
 * `F4.244` — every store that belongs to one session, cleared together on a
 * session change of `store`: the Query cache `client` and the persisted
 * copilot session. Returns the unsubscribe.
 */
export function bindSessionStores<S extends SessionState>(store: SessionStore<S>, client: { clear(): void }): () => void {
  return bindQueryCacheToSession(store, {
    clear() {
      client.clear();
      clearCopilotSession();
    },
  });
}
