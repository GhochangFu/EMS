import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { expect, vi } from "vitest";

import * as loginApi from "../api/login";
import * as oidcApi from "../api/oidc";
import { RETURN_PATH_KEY } from "../lib/return-path";
import { AuthCallbackPage } from "./auth-callback-page";

/**
 * `F3.33` U5 (ADR 0083) — the auth callback's waiting sentence names `IONSiTE NEXUS`.
 *
 * Assertions live here; `auth-callback-page.test.tsx` is the Vitest entry point (ADR 0014).
 * `completeOidcLogin` is held on a promise that never settles, so the page stays on the waiting
 * branch and no request leaves the test process (`F4.160`).
 */

/** A1 — the waiting sentence. */
export function readsTheWaitingSentence(): void {
  vi.spyOn(oidcApi, "completeOidcLogin").mockReturnValue(new Promise(() => undefined));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthCallbackPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText("Please wait while Keycloak returns you to IONSiTE NEXUS.")).toBeTruthy();
}

/*
 * `F3.77` (plan D10) — the Keycloak callback lands in the same tab, so the
 * return path a 401 kept in `sessionStorage` is still there. After the session
 * is set the page navigates to it with `replace`, else to `/`. The probe
 * renders only once the router has left `/auth/callback`.
 */

export const WALL_URL = "/control-room/site/x/sld?wall=1&every=30";

function ProbeAfterCallback() {
  const location = useLocation();
  const type = useNavigationType();
  return <p data-testid="after-callback">{`${location.pathname}${location.search}|${type}`}</p>;
}

async function completeTheCallback(): Promise<string> {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("auth-callback-page.spec: no fetch expected"))),
  );
  vi.spyOn(oidcApi, "completeOidcLogin").mockResolvedValue({
    accessToken: "token-oidc",
    idToken: "id-token",
  } as Awaited<ReturnType<typeof oidcApi.completeOidcLogin>>);
  vi.spyOn(loginApi, "fetchCurrentUser").mockResolvedValue({
    user: { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" },
    scope: { kind: "global", locations: [], assetGroups: [], assetIds: [] },
  } as unknown as Awaited<ReturnType<typeof loginApi.fetchCurrentUser>>);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/auth/callback?code=c&state=s"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="*" element={<ProbeAfterCallback />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return (await screen.findByTestId("after-callback")).textContent ?? "";
}

/** A2 — a completed callback with a stored path lands on it with replace, and spends it. */
export async function navigatesToTheReturnPath(): Promise<void> {
  window.sessionStorage.setItem(RETURN_PATH_KEY, WALL_URL);
  expect(await completeTheCallback()).toBe(`${WALL_URL}|REPLACE`);
  expect(window.sessionStorage.getItem(RETURN_PATH_KEY)).toBeNull();
}

/** A3 — a completed callback with no stored path lands on `/` with replace. */
export async function navigatesToTheRootWithoutAReturnPath(): Promise<void> {
  expect(await completeTheCallback()).toBe("/|REPLACE");
}
