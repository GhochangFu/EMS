import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { expect, vi } from "vitest";

import * as loginApi from "../api/login";
import * as oidcApi from "../api/oidc";
import { RETURN_PATH_KEY } from "../lib/return-path";
import { useAuthStore } from "../stores/auth-store";
import { LoginPage } from "./login-page";

/**
 * `F3.33` U4 (ADR 0083; plan OQ1–OQ4) — the login page reads `IONSiTE NEXUS`: the text wordmark
 * replaces the logo image, the hero headline is the client's descriptor plus the old tail, and the
 * card, the role pill and the footer carry the new name.
 *
 * Assertions live here; `login-page.test.tsx` is the Vitest entry point (ADR 0014). The page
 * makes no request on mount, and `fetch` is stubbed to fail loudly so a spec never reaches a real
 * API on `:4000` (`F4.160`). Local auth mode is forced so the pill row renders.
 */

function renderLogin(): void {
  vi.spyOn(oidcApi, "isOidcEnabled").mockReturnValue(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("login-page.spec: no fetch expected"))),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function normalised(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

const WORDMARK = { name: "IONSiTE NEXUS" } as const;

/** L1 — the wordmark is a named image. */
export function showsTheWordmark(): void {
  renderLogin();
  expect(screen.getByRole("img", WORDMARK)).toBeTruthy();
}

/** L2 — the hero headline is the descriptor plus the old tail. */
export function readsTheHeroHeadline(): void {
  renderLogin();
  expect(normalised(screen.getByRole("heading", { level: 1 }))).toBe(
    "Integrated Building, Energy, Water & Utility Management · Smart insight, always on.",
  );
}

/** L2b — the accent span holds "Building, Energy, Water & Utility". */
export function accentsTheDescriptorCore(): void {
  renderLogin();
  const accent = screen.getByRole("heading", { level: 1 }).querySelector("span.text-accent");
  expect(accent?.textContent).toBe("Building, Energy, Water & Utility");
}

/** L3 — the card heading. */
export function readsTheCardHeading(): void {
  renderLogin();
  expect(screen.getByRole("heading", { level: 2, name: "Sign in to IONSiTE NEXUS" })).toBeTruthy();
}

/** L4 — the card sentence follows the descriptor. */
export function readsTheCardSentence(): void {
  renderLogin();
  expect(
    screen.getByText(
      "Enterprise SSO and local pilot access for the Integrated Building, Energy, Water & Utility Management Platform.",
    ),
  ).toBeTruthy();
}

/** L5 — the three role pills, in order. */
export function readsTheRolePills(): void {
  renderLogin();
  const first = screen.getByText("NEXUS Admin");
  expect([...first.parentElement!.children].map((c) => c.textContent)).toEqual([
    "NEXUS Admin",
    "IBMS Operator",
    "Energy Manager",
  ]);
}

/** L6 — the footer version line. */
export function readsTheFooterVersion(): void {
  renderLogin();
  expect(screen.getByText(/IONSiTE NEXUS v0\.1/)).toBeTruthy();
}

/** L7 — no `<img>` element; L1's lookup is the positive control. */
export function drawsNoImgElement(): void {
  renderLogin();
  expect(screen.getByRole("img", WORDMARK)).toBeTruthy();
  expect(document.querySelector("img")).toBeNull();
}

/** L8 — no text reads TRINETRA; L1's lookup is the positive control. */
export function readsNoTrinetra(): void {
  renderLogin();
  expect(screen.getByRole("img", WORDMARK)).toBeTruthy();
  expect(screen.queryByText(/trinetra/i)).toBeNull();
}

/*
 * `F3.77` (ADR 0087 Amendment 3 ruling 8, plan D10, OQ6) — the session-ended
 * banner and the return path. A 401 on a wall URL leaves the path in
 * `sessionStorage` (`api/http.ts`); the login page shows the banner while one
 * is stored and, after a successful sign-in, navigates to it with `replace`,
 * else to `/`. `ProbeAfterLogin` renders only once the router has left
 * `/login`, so a `findBy` on it waits for the navigation itself.
 */

export const SESSION_ENDED = "Session ended — sign in to return to the wall view";
export const WALL_URL = "/control-room/site/x/sld?wall=1&every=30";

function ProbeAfterLogin() {
  const location = useLocation();
  const type = useNavigationType();
  return <p data-testid="after-login">{`${location.pathname}${location.search}|${type}`}</p>;
}

function renderLoginRoutes(oidc = false): void {
  vi.spyOn(oidcApi, "isOidcEnabled").mockReturnValue(oidc);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("login-page.spec: no fetch expected"))),
  );
  vi.spyOn(loginApi, "loginRequest").mockResolvedValue({
    accessToken: "token-new",
    tokenType: "Bearer",
    expiresIn: "8h",
    user: { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" },
  } as Awaited<ReturnType<typeof loginApi.loginRequest>>);
  vi.spyOn(loginApi, "fetchCurrentUser").mockResolvedValue({
    user: { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "admin" },
    scope: { kind: "global", locations: [], assetGroups: [], assetIds: [] },
  } as unknown as Awaited<ReturnType<typeof loginApi.fetchCurrentUser>>);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<ProbeAfterLogin />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function signInLocally(): Promise<string> {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "admin123" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in securely" }));
  return (await screen.findByTestId("after-login")).textContent ?? "";
}

/** L9 — with a stored return path, the banner shows. */
export function showsTheSessionEndedBanner(): void {
  window.sessionStorage.setItem(RETURN_PATH_KEY, WALL_URL);
  renderLoginRoutes();
  expect(screen.getByRole("status").textContent).toBe(SESSION_ENDED);
}

/** L10 — the banner shows in OIDC mode too, which is how production signs in. */
export function showsTheBannerInOidcMode(): void {
  window.sessionStorage.setItem(RETURN_PATH_KEY, WALL_URL);
  renderLoginRoutes(true);
  expect(screen.getByRole("button", { name: "Sign in securely with Keycloak" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe(SESSION_ENDED);
}

/** L11 — with no stored path no banner shows; the card heading is the positive control. */
export function showsNoBannerWithoutAReturnPath(): void {
  renderLoginRoutes();
  expect(screen.getByRole("heading", { level: 2, name: "Sign in to IONSiTE NEXUS" })).toBeTruthy();
  expect(screen.queryByText(SESSION_ENDED)).toBeNull();
}

/** L12 — a refused stored value shows no banner (it is validated on read). */
export function showsNoBannerForARefusedPath(): void {
  window.sessionStorage.setItem(RETURN_PATH_KEY, "//evil.example");
  renderLoginRoutes();
  expect(screen.getByRole("heading", { level: 2, name: "Sign in to IONSiTE NEXUS" })).toBeTruthy();
  expect(screen.queryByText(SESSION_ENDED)).toBeNull();
}

/** L13 — a sign-in with a stored path lands on it, replacing the history entry, and spends it. */
export async function navigatesToTheReturnPath(): Promise<void> {
  window.sessionStorage.setItem(RETURN_PATH_KEY, WALL_URL);
  renderLoginRoutes();
  expect(await signInLocally()).toBe(`${WALL_URL}|REPLACE`);
  expect(window.sessionStorage.getItem(RETURN_PATH_KEY)).toBeNull();
}

export const DEACTIVATED = "Your account is deactivated. Ask an administrator.";

/** L15 (`F4.203`) — a session ended by a deactivated 401 shows the sentence once. */
export function showsTheDeactivatedSentence(): void {
  useAuthStore.getState().rememberAuthFailure("account_deactivated");
  renderLoginRoutes();
  expect(screen.getAllByText(DEACTIVATED)).toHaveLength(1);
}

/** L16 (`F4.203`) — in OIDC mode too, which is how production signs in. */
export function showsTheDeactivatedSentenceInOidcMode(): void {
  useAuthStore.getState().rememberAuthFailure("account_deactivated");
  renderLoginRoutes(true);
  expect(screen.getByRole("button", { name: "Sign in securely with Keycloak" })).toBeTruthy();
  expect(screen.getAllByText(DEACTIVATED)).toHaveLength(1);
}

/** L17 (`F4.203`) — no reason (a plain 401) shows nothing; the card heading is the positive control. */
export function aPlain401ShowsNothing(): void {
  renderLoginRoutes();
  expect(screen.getByRole("heading", { level: 2, name: "Sign in to IONSiTE NEXUS" })).toBeTruthy();
  expect(screen.queryByText(DEACTIVATED)).toBeNull();
}

/** L18 (`F4.203`) — a sign-in consumes the reason (the store, not the page that navigates away). */
export async function aSignInConsumesTheReason(): Promise<void> {
  useAuthStore.getState().rememberAuthFailure("account_deactivated");
  renderLoginRoutes();
  expect(await signInLocally()).toBe("/|REPLACE");
  expect(useAuthStore.getState().authFailureReason).toBeNull();
}

/** L14 — a sign-in with no stored path lands on `/`, replacing the history entry. */
export async function navigatesToTheRootWithoutAReturnPath(): Promise<void> {
  renderLoginRoutes();
  expect(await signInLocally()).toBe("/|REPLACE");
}
