import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import * as oidcApi from "../api/oidc";
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
