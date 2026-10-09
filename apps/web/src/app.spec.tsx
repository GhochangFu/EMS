import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AccessibleScope } from "@bms/shared";

import * as loginApi from "./api/login";
import { App } from "./app";
import { RETURN_PATH_KEY } from "./lib/return-path";
import { useAuthStore, type AuthUser } from "./stores/auth-store";

/**
 * `F4.156` — the `/me` effect in `App` keeps the stored OIDC id token.
 *
 * Assertions live here; `app.test.tsx` is the Vitest entry point and carries
 * the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 *
 * The effect runs on every load with an access token (`F2.10`, ADR 0098 B9; it
 * used to run only while no scope was stored). It re-sets the session with the
 * fresh `/me` user and scope. It used to call
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

/**
 * A1 (`F3.32f` slice 1, ADR 0086 decision 8) — `/attributions` is a plain authenticated route: a
 * signed-in viewer reaches the page.
 */
export async function aViewerReachesTheAttributionsPage(): Promise<void> {
  const viewer: AuthUser = {
    ...USER,
    id: "22222222-2222-4222-8222-222222222222",
    email: "viewer@bms.local",
    displayName: "Viewer",
    role: "viewer",
  };
  const accessToken = unexpiredAccessToken();
  const fetchCurrentUser = vi.spyOn(loginApi, "fetchCurrentUser").mockResolvedValue({ user: viewer, scope: SCOPE });
  // AppShell's status indicator fetches; an unstubbed fetch would reach the real API on :4000.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  useAuthStore.setState({ accessToken, oidcIdToken: ID_TOKEN, user: viewer, scope: null });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/attributions"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  // Positive control: the session held, so the route did not bounce to /login.
  await waitFor(() => {
    expect(fetchCurrentUser).toHaveBeenCalled();
  });
  expect(await screen.findByRole("heading", { name: "Attributions" })).toBeInTheDocument();
}

/** A wall URL (`F3.77` plan D10), the tab's address when the stored session turns out to be dead. */
export const WALL_URL = "/control-room/site/x/sld?wall=1&every=30";

/** An access token whose `exp` has passed — `isJwtExpired` reads it as expired. */
function expiredAccessToken(): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

/**
 * Renders `App` with the tab at {@link WALL_URL}. `App` reads `window.location` (as
 * `clearSessionOnAuthFailure` does), and a `MemoryRouter` leaves jsdom's at `/`, so the spec moves
 * it with `history.replaceState`; the caller restores it.
 */
function renderAtTheWallUrl(): void {
  window.history.replaceState(null, "", WALL_URL);
  // AppShell's status indicator fetches; an unstubbed fetch would reach the real API on :4000.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[WALL_URL]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * R1 (`F3.77` plan D10) — a wall tab reloaded with an expired token keeps its wall URL as the return
 * path, as a 401 does. Positive control first: the session was cleared, so the store is the
 * effect's doing.
 */
export async function anExpiredTokenOnAWallUrlKeepsTheReturnPath(): Promise<void> {
  vi.spyOn(loginApi, "fetchCurrentUser").mockReturnValue(new Promise(() => undefined));
  useAuthStore.setState({ accessToken: expiredAccessToken(), oidcIdToken: ID_TOKEN, user: USER, scope: SCOPE });

  renderAtTheWallUrl();

  await waitFor(() => {
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
  expect(sessionStorage.getItem(RETURN_PATH_KEY)).toBe(WALL_URL);
}

/**
 * R2 (`F3.77` plan D10) — the same when the token is unexpired but `/me` refuses it: the effect
 * clears the session and keeps the wall URL.
 */
export async function aRefusedMeOnAWallUrlKeepsTheReturnPath(): Promise<void> {
  const fetchCurrentUser = vi.spyOn(loginApi, "fetchCurrentUser").mockRejectedValue(new Error("401"));
  useAuthStore.setState({ accessToken: unexpiredAccessToken(), oidcIdToken: ID_TOKEN, user: USER, scope: null });

  renderAtTheWallUrl();

  await waitFor(() => {
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
  expect(fetchCurrentUser, "control: the /me effect ran").toHaveBeenCalled();
  expect(sessionStorage.getItem(RETURN_PATH_KEY)).toBe(WALL_URL);
}

export const DEACTIVATED_SENTENCE = "Your account is deactivated. Ask an administrator.";

const DEACTIVATED_401 = {
  statusCode: 401,
  message: "This account is deactivated",
  error: "Unauthorized",
  code: "account_deactivated",
};

/**
 * `F4.203` (OQ2) — renders `App` on `/login` with a stored token and no scope, so the `/me`
 * effect runs, and answers `/me` with a 401 carrying `body`. The real `fetchCurrentUser` runs: a
 * spy on it would replace the read this spec pins. Returns the `fetch` stub.
 */
function renderWithARefusedMe(body: unknown): ReturnType<typeof vi.fn> {
  const fetchStub = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(
      String(input).includes("/api/v1/auth/me")
        ? new Response(JSON.stringify(body), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          })
        : new Response("{}", { status: 200 }),
    ),
  );
  vi.stubGlobal("fetch", fetchStub);
  useAuthStore.setState({ accessToken: unexpiredAccessToken(), oidcIdToken: null, user: USER, scope: null });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchStub;
}

/** D1 — a deactivated `/me` 401 on load records the reason before the session is cleared. */
export async function aDeactivatedMeOnLoadRecordsTheReason(): Promise<void> {
  const fetchStub = renderWithARefusedMe(DEACTIVATED_401);
  await waitFor(() => {
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
  expect(
    fetchStub.mock.calls.some(([input]) => String(input).includes("/api/v1/auth/me")),
    "control: the /me effect fetched /me",
  ).toBe(true);
  expect(useAuthStore.getState().authFailureReason).toBe("account_deactivated");
}

/** D2 — and the sign-in page then shows the deactivated sentence. */
export async function aDeactivatedMeOnLoadShowsTheSentence(): Promise<void> {
  renderWithARefusedMe(DEACTIVATED_401);
  expect(await screen.findByText(DEACTIVATED_SENTENCE)).toBeInTheDocument();
}

/** D3 — a plain `/me` 401 shows nothing; the card heading is the positive control. */
export async function aPlainMeOnLoadShowsNothing(): Promise<void> {
  renderWithARefusedMe({ statusCode: 401, message: "Invalid token", error: "Unauthorized" });
  await waitFor(() => {
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
  expect(screen.getByRole("heading", { level: 2, name: "Sign in to IONSiTE NEXUS" })).toBeInTheDocument();
  expect(useAuthStore.getState().authFailureReason).toBeNull();
  expect(screen.queryByText(DEACTIVATED_SENTENCE)).toBeNull();
}

/** A scope as `/me` serves it after a location was created or moved elsewhere. */
const FRESH_SCOPE: AccessibleScope = {
  kind: "location",
  locations: [
    { id: "loc-r", code: "R", slug: "r", name: "Root", type: "site", province: null, parentId: null },
    { id: "loc-c", code: "C", slug: "c", name: "Child", type: "site", province: null, parentId: "loc-r" },
  ],
  assetGroups: [],
  assetIds: [],
};

/** The persisted copy from an earlier session: the same user, no Child yet. */
const STALE_SCOPE: AccessibleScope = {
  ...FRESH_SCOPE,
  locations: [FRESH_SCOPE.locations[0]!],
};

/**
 * `F2.10` (ADR 0098 B9) — `/me` is refetched on every load with a token, even with a stored scope,
 * and the served scope replaces the persisted one. The id token is kept (`F4.156`).
 */
export async function aStoredScopeIsReplacedOnLoad(): Promise<void> {
  const accessToken = unexpiredAccessToken();
  const fetchCurrentUser = vi
    .spyOn(loginApi, "fetchCurrentUser")
    .mockResolvedValue({ user: USER, scope: FRESH_SCOPE });
  useAuthStore.setState({ accessToken, oidcIdToken: ID_TOKEN, user: USER, scope: STALE_SCOPE });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await waitFor(() => {
    expect(useAuthStore.getState().scope).toEqual(FRESH_SCOPE);
  });
  expect(fetchCurrentUser).toHaveBeenCalledWith(accessToken);
  expect(useAuthStore.getState().oidcIdToken).toBe(ID_TOKEN);
  // The effect must not re-run on its own `setSession`: give a re-run time to start.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(fetchCurrentUser).toHaveBeenCalledTimes(1);
}

/**
 * `F2.10` (B8, B9) — a scope written while the load `/me` is in flight (a create or a move
 * refreshed it) is newer: the late load answer does not replace it.
 */
export async function aLateLoadAnswerDoesNotReplaceANewerScope(): Promise<void> {
  const accessToken = unexpiredAccessToken();
  let resolve: (value: { user: AuthUser; scope: AccessibleScope }) => void = () => undefined;
  const fetchCurrentUser = vi.spyOn(loginApi, "fetchCurrentUser").mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  useAuthStore.setState({ accessToken, oidcIdToken: ID_TOKEN, user: USER, scope: STALE_SCOPE });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await waitFor(() => {
    expect(fetchCurrentUser).toHaveBeenCalledWith(accessToken);
  });
  const newer: AccessibleScope = { ...FRESH_SCOPE };
  useAuthStore.setState({ scope: newer });
  resolve({ user: USER, scope: STALE_SCOPE });
  await new Promise((r) => setTimeout(r, 50));
  expect(useAuthStore.getState().scope).toBe(newer);
}

/**
 * `F2.10` (plan O1) — a failed refetch with a stored scope keeps the session: the stored copy
 * stands. A dead token is caught by `isJwtExpired` and by the next call's 401.
 */
export async function aFailedRefetchKeepsAStoredSession(): Promise<void> {
  const accessToken = unexpiredAccessToken();
  let reject: (err: Error) => void = () => undefined;
  const fetchCurrentUser = vi.spyOn(loginApi, "fetchCurrentUser").mockReturnValue(
    new Promise((_resolve, r) => {
      reject = r;
    }),
  );
  useAuthStore.setState({ accessToken, oidcIdToken: ID_TOKEN, user: USER, scope: STALE_SCOPE });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await waitFor(() => {
    expect(fetchCurrentUser, "control: the /me effect ran").toHaveBeenCalled();
  });
  reject(new Error("Current user failed (503)"));
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(useAuthStore.getState().accessToken).toBe(accessToken);
  expect(useAuthStore.getState().scope).toEqual(STALE_SCOPE);
}
