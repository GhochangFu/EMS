import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AccessibleScope } from "@bms/shared";

import * as loginApi from "./api/login";
import { App } from "./app";
import { useAuthStore, type AuthUser } from "./stores/auth-store";

/**
 * `F4.156` — the `/me` effect in `App` keeps the stored OIDC id token.
 *
 * Assertions live here; `app.test.tsx` is the Vitest entry point and carries
 * the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 *
 * The effect runs only while the store holds an access token and no scope. It
 * re-sets the session with the fresh `/me` user and scope. It used to call
 * `setSession` with three arguments, and the store defaulted the fourth
 * (`oidcIdToken`) to `null` — so the re-set erased the id token, and a later
 * logout reached Keycloak without an `id_token_hint`. `setSession` now requires
 * the id token, and this spec pins that the effect passes the stored one.
 */

const USER: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
};

const SCOPE: AccessibleScope = { kind: "global", locations: [], assetGroups: [], assetIds: [] };

const ID_TOKEN = "oidc-id-token-f4-156";

/**
 * An unexpired JWT-shaped token. The expiry effect in `App` clears the session
 * for anything it cannot decode, which would erase the id token for the wrong
 * reason and cancel the `/me` effect's resolution.
 */
function unexpiredAccessToken(): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

/**
 * The `/me` re-set keeps the stored OIDC id token. Positive control first: the
 * scope `/me` returned lands in the store, so the effect did run `setSession`.
 */
export async function theMeEffectKeepsTheStoredIdToken(): Promise<void> {
  const accessToken = unexpiredAccessToken();
  const fetchCurrentUser = vi
    .spyOn(loginApi, "fetchCurrentUser")
    .mockResolvedValue({ user: USER, scope: SCOPE });
  useAuthStore.setState({ accessToken, oidcIdToken: ID_TOKEN, user: USER, scope: null });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await waitFor(() => {
    expect(useAuthStore.getState().scope).toEqual(SCOPE);
  });
  expect(fetchCurrentUser).toHaveBeenCalledWith(accessToken);
  expect(useAuthStore.getState().oidcIdToken).toBe(ID_TOKEN);
}
