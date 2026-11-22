import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { expect, vi } from "vitest";

import * as loginApi from "../api/login";
import * as oidcApi from "../api/oidc";
import { RETURN_PATH_KEY } from "../lib/return-path";
import { useAuthStore } from "../stores/auth-store";
import { LOGIN_DESCRIPTION, LoginPage } from "./login-page";

/**
 * `F4.398` U4 (ADR 0142 decisions 1 and 4; plan OQ1, OQ2) — the login page reads `Verve`: the
 * hero shows the logo, the hero headline is the tagline as plain text, and the card, the role
 * pill and the footer carry the new name.
 *
 * Assertions live here; `login-page.test.tsx` is the Vitest entry point (ADR 0014). The page's one
 * request on mount is `F4.341`'s `GET /public/appearance`, whose failure it swallows; `fetch` is
 * stubbed to fail loudly so a spec never reaches a real API on `:4000` (`F4.160`). Local auth mode
 * is forced so the pill row renders.
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

const WORDMARK = { name: "Verve" } as const;

/** L1 — the wordmark is a named image. */
export function showsTheWordmark(): void {
  renderLogin();
  expect(screen.getByRole("img", WORDMARK)).toBeTruthy();
}

/** L2 — the hero headline is the tagline, whole, as plain text (no accent span). */
export function readsTheHeroHeadline(): void {
  renderLogin();
  const headline = screen.getByRole("heading", { level: 1 });
  expect(normalised(headline)).toBe("The pulse of every site");
  expect(headline.children).toHaveLength(0);
}

/** L3 — the card heading. */
export function readsTheCardHeading(): void {
  renderLogin();
  expect(screen.getByRole("heading", { level: 2, name: "Sign in to Verve" })).toBeTruthy();
}

/** L4 — the card sentence is the short one (plan OQ1). */
export function readsTheCardSentence(): void {
  renderLogin();
  expect(screen.getByText("Enterprise SSO and local pilot access.")).toBeTruthy();
}

/** L5 — the three role pills, in order. */
export function readsTheRolePills(): void {
  renderLogin();
  const first = screen.getByText("Verve Admin");
  expect([...first.parentElement!.children].map((c) => c.textContent)).toEqual([
    "Verve Admin",
    "IBMS Operator",
    "Energy Manager",
  ]);
}

/** L6 — the footer version line. */
export function readsTheFooterVersion(): void {
  renderLogin();
  expect(screen.getByText(/Verve v0\.1/)).toBeTruthy();
}

/** L7 — no `<img>` element; L1's lookup is the positive control. */
export function drawsNoImgElement(): void {
  renderLogin();
  expect(screen.getByRole("img", WORDMARK)).toBeTruthy();
  expect(document.querySelector("img")).toBeNull();
}

/** L8 — no text reads TRINETRA or the IONSiTE NEXUS name; L1's lookup is the positive control. */
export function readsNoOldName(): void {
  renderLogin();
  expect(screen.getByRole("img", WORDMARK)).toBeTruthy();
  expect(screen.queryByText(/trinetra/i)).toBeNull();
  expect(screen.queryByText(/\bion\s?site|nexus/i)).toBeNull();
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
  expect(screen.getByRole("heading", { level: 2, name: "Sign in to Verve" })).toBeTruthy();
  expect(screen.queryByText(SESSION_ENDED)).toBeNull();
}

/** L12 — a refused stored value shows no banner (it is validated on read). */
export function showsNoBannerForARefusedPath(): void {
  window.sessionStorage.setItem(RETURN_PATH_KEY, "//evil.example");
  renderLoginRoutes();
  expect(screen.getByRole("heading", { level: 2, name: "Sign in to Verve" })).toBeTruthy();
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
  expect(screen.getByRole("heading", { level: 2, name: "Sign in to Verve" })).toBeTruthy();
  expect(screen.queryByText(DEACTIVATED)).toBeNull();
}

/** L18 (`F4.203`) — a sign-in consumes the reason (the store, not the page that navigates away). */
export async function aSignInConsumesTheReason(): Promise<void> {
  useAuthStore.getState().rememberAuthFailure("account_deactivated");
  renderLoginRoutes();
  expect(await signInLocally()).toBe("/|REPLACE");
  expect(useAuthStore.getState().authFailureReason).toBeNull();
}

/** L19 (`F4.203`) — a reason that lands after the page mounts still renders (a subscription, not a read). */
export async function aLateReasonStillRenders(): Promise<void> {
  renderLoginRoutes();
  expect(screen.queryByText(DEACTIVATED), "control: no sentence before the reason lands").toBeNull();
  act(() => {
    useAuthStore.getState().rememberAuthFailure("account_deactivated");
  });
  expect(await screen.findByText(DEACTIVATED)).toBeTruthy();
}

/**
 * L20 (`F4.203`, security L1) — starting a local sign-in clears the reason, so it never stays for
 * the next person. The sign-in is refused, so `setSession` cannot be what cleared it.
 */
export async function aLocalSignInAttemptClearsTheReason(): Promise<void> {
  useAuthStore.getState().rememberAuthFailure("account_deactivated");
  renderLoginRoutes();
  vi.spyOn(loginApi, "loginRequest").mockRejectedValue(new Error("Invalid email or password"));
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in securely" }));
  expect(await screen.findByText("Invalid email or password"), "control: the attempt ran").toBeTruthy();
  expect(useAuthStore.getState().authFailureReason).toBeNull();
}

/** L21 (`F4.203`, security L1) — starting a Keycloak sign-in clears the reason too. */
export async function anOidcSignInAttemptClearsTheReason(): Promise<void> {
  useAuthStore.getState().rememberAuthFailure("account_deactivated");
  renderLoginRoutes(true);
  const start = vi.spyOn(oidcApi, "startOidcLogin").mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Sign in securely with Keycloak" }));
  await waitFor(() => {
    expect(start, "control: the Keycloak sign-in started").toHaveBeenCalled();
  });
  expect(useAuthStore.getState().authFailureReason).toBeNull();
}

/** L14 — a sign-in with no stored path lands on `/`, replacing the history entry. */
export async function navigatesToTheRootWithoutAReturnPath(): Promise<void> {
  renderLoginRoutes();
  expect(await signInLocally()).toBe("/|REPLACE");
}

/**
 * L22 (`F4.204`) — a refused sign-in whose error carries the raw Nest envelope renders the
 * envelope's sentence, not the JSON. `loginRequest` throws the response text unchanged.
 */
export async function aRawEnvelopeReadsAsItsSentence(): Promise<void> {
  renderLoginRoutes();
  vi.spyOn(loginApi, "loginRequest").mockRejectedValue(
    new Error('{"statusCode":401,"message":"Invalid email or password","error":"Unauthorized"}'),
  );
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in securely" }));
  const alert = await screen.findByText("Invalid email or password");
  expect(alert.textContent).not.toContain('{"');
}

/**
 * `F4.341` (ADR 0118 decision 12, Q5) — the sign-in page paints the portal default from
 * `GET /public/appearance` (no token), caches it as `bms.portal-appearance`, and writes neither
 * user cache: the portal value is never taken for the user's own.
 */
export async function paintsThePortalAppearance(): Promise<void> {
  vi.spyOn(oidcApi, "isOidcEnabled").mockReturnValue(false);
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify({ designSystem: "swiss-grid", colourProfile: "forest" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(document.documentElement.getAttribute("data-design")).toBe("swiss-grid"));
  expect(document.documentElement.getAttribute("data-profile")).toBe("forest");
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  expect(String(url).endsWith("/api/v1/public/appearance")).toBe(true);
  expect(new Headers(init?.headers).get("Authorization")).toBeNull();
  expect(JSON.parse(localStorage.getItem("bms.portal-appearance") ?? "null")).toEqual({ designSystem: "swiss-grid", colourProfile: "forest" });
  expect(localStorage.getItem("bms.design")).toBeNull();
  expect(localStorage.getItem("bms.profile")).toBeNull();
}

/**
 * LH1 (ADR 0142 Amendment 3 item 2) — the login page names no client: the description is the new
 * sentence and nothing on the page reads "Ion Exchange". The lookup of the sentence is the
 * positive control.
 */
export function namesNoClient(): void {
  renderLogin();
  expect(LOGIN_DESCRIPTION).toBe(
    "One operator console for power, HVAC, water, utilities, alarms and work orders, across every site you run.",
  );
  expect(screen.getByText(LOGIN_DESCRIPTION)).toBeTruthy();
  expect(document.body.textContent ?? "").not.toMatch(/ion\s*exchange/i);
}

/**
 * LH2 (Amendment 3 item 3) — the panel says what the product does: five domains, three feature
 * tiles, and none of the three fixed numbers the page used to show.
 */
export function listsDomainsAndFeaturesNotNumbers(): void {
  renderLogin();
  const domains = within(screen.getByRole("list", { name: "What Verve monitors" })).getAllByRole("listitem");
  expect(domains.map(normalised)).toEqual(["Power", "HVAC", "UPS", "Water", "Environment"]);
  const features = within(screen.getByRole("list", { name: "What Verve does" })).getAllByRole("listitem");
  expect(features.map(normalised)).toEqual([
    "Real-time telemetryEach reading, as it arrives",
    "Alarms that reach peopleRouted, tracked, closed",
    "Energy insightUse, cost and trends",
  ]);
  const text = document.body.textContent ?? "";
  expect(text).not.toContain("99.98%");
  expect(text).not.toMatch(/Uptime/i);
  expect(screen.queryByText("10")).toBeNull();
}

/**
 * LH3 (Amendment 3 items 1, 4 and 5) — the hero is centred over the site network, the network is
 * decoration behind it, and the tiles that sit over the network are opaque (`bg-chrome`, no
 * opacity suffix), so nothing shows through their text.
 */
export function centresTheHeroOverTheNetwork(): void {
  renderLogin();
  const headline = screen.getByRole("heading", { level: 1 });
  const hero = headline.closest("section");
  const heroClasses = hero?.getAttribute("class")?.split(" ") ?? [];
  expect(heroClasses).toContain("items-center");
  expect(heroClasses).toContain("text-center");
  const network = hero?.querySelector("[data-part='site-network']");
  expect(network?.getAttribute("aria-hidden")).toBe("true");
  expect(network?.contains(headline)).toBe(false);
  expect(hero?.firstElementChild).toBe(network);
  for (const tile of within(screen.getByRole("list", { name: "What Verve does" })).getAllByRole("listitem")) {
    expect(tile.getAttribute("class")?.split(" ")).toContain("bg-chrome");
  }
  for (const chip of within(screen.getByRole("list", { name: "What Verve monitors" })).getAllByRole("listitem")) {
    expect(chip.getAttribute("class")?.split(" ")).toContain("bg-chrome");
  }
}
