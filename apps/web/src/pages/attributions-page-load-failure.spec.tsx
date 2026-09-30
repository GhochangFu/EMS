import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AuthUser } from "../stores/auth-store";
import { AttributionsPage } from "./attributions-page";

// `F3.32h`: the credits chunk fails to load, as a removed or unreachable chunk does. Its own file,
// so the failing module never reaches the registry the other attributions claims read.
vi.mock("../components/widgets/mimic-symbol-libraries/credits", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

/**
 * `F3.32h` — the attributions page when a lazy chunk does not load.
 * `attributions-page-load-failure.test.tsx` is the Vitest entry.
 */

const viewer = {
  id: "u1",
  email: "viewer@bms.local",
  displayName: "Viewer",
  role: "viewer",
} as unknown as AuthUser;

/** T17 — the page lists every library without credits, and says that something did not load. */
export async function aFailedCreditsLoadShowsTheAlert(): Promise<void> {
  // AppShell's status indicator fetches; an unstubbed fetch would reach the real API on :4000.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AttributionsPage user={viewer} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  expect((await screen.findByRole("alert", {}, { timeout: 5000 })).textContent).toBe(
    "Some library notices or credits did not load. Reload the page to try again.",
  );
  // Positive control: the seven libraries still render, with no per-file credits.
  expect(screen.getAllByTestId("attribution-entry")).toHaveLength(7);
  expect(screen.queryByText(/Per-file credits/)).toBeNull();
}
