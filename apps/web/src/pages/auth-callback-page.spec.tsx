import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import * as oidcApi from "../api/oidc";
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
