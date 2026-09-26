import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import { locationKpiSummarySchema } from "@bms/shared/contracts";
import type { LocationKpiSummary } from "@bms/shared";

import * as locationsApi from "../api/locations";
import { SmocLegacyRedirect } from "./smoc-legacy-redirect";

/**
 * `F3.70` U5a — `SmocLegacyRedirect`, the element behind the seven `/cr-*`
 * routes (D6, D7, OQ3, OQ4). Rows R1–R5 of the plan's U5a.
 *
 * Assertions live here; `smoc-legacy-redirect.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014,
 * ADR 0042 decision 2).
 *
 * The component finds `RSMOC-WC` in `ESKOM` in the caller's readable KPI list
 * and sends the caller to that site's tab; a list without it, or a failed
 * read, sends the caller to `/control-room`. It decides from `data`, never
 * from `status`. `ControlRoomScopeRoute` is not in this harness: its own spec
 * proves the `none` case, and `tests/f3.70-smoc-site-view.test.ts` I2 proves
 * each `/cr-*` route wraps this component in it.
 *
 * `fetch` itself is a spy, and `cleanupRedirect` fails the case if anything
 * reached it: a throwing `fetch` alone proves nothing, because react-query
 * turns the throw into `isError`.
 */

const ESKOM_ORG = { id: "org-eskom", code: "ESKOM", name: "Eskom" };
const PHE_ORG = { id: "org-phe", code: "PHEWB", name: "PHE West Bengal" };

const SMOC_SITE_ID = "22222222-2222-4222-8222-222222222222";

function site(opts: {
  id: string;
  code: string;
  organization: { id: string; code: string; name: string };
}): LocationKpiSummary {
  return locationKpiSummarySchema.parse({
    id: opts.id,
    name: `Site ${opts.code}`,
    code: opts.code,
    type: "smoc_campus",
    province: null,
    organization: opts.organization,
    rtuCount: 0,
    assetCount: 3,
    freshAssetCount: 0,
    totalKw: 0,
    openAlarms: 0,
    criticalAlarms: 0,
    scopeLabel: "full",
  });
}

const PHE_SITE = site({
  id: "33333333-3333-4333-8333-333333333333",
  code: "PHE-1",
  organization: PHE_ORG,
});

/** RSMOC-WC is not first, so a redirect to `items[0]` reads as wrong. */
const ADMIN_ITEMS: LocationKpiSummary[] = [
  PHE_SITE,
  site({ id: SMOC_SITE_ID, code: "RSMOC-WC", organization: ESKOM_ORG }),
];

const PHE_ONLY_ITEMS: LocationKpiSummary[] = [PHE_SITE];

type Read = LocationKpiSummary[] | "pending" | "rejected";

let fetchSpy: Mock | null = null;

/** Wherever the redirect sent us: the targets never match the `/cr-hvac` route. */
function Landed() {
  const { pathname } = useLocation();
  return <p>landed on {pathname}</p>;
}

function renderRedirect(read: Read): void {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  const spy = vi.spyOn(locationsApi, "fetchLocationKpis");
  if (read === "pending") {
    spy.mockReturnValue(new Promise(() => undefined));
  } else if (read === "rejected") {
    spy.mockRejectedValue(new Error("dashboard 500"));
  } else {
    spy.mockResolvedValue({ items: read });
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/cr-hvac"]}>
        <Routes>
          <Route path="/cr-hvac" element={<SmocLegacyRedirect tab="hvac" />} />
          <Route path="*" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** R1 — RSMOC-WC readable: the caller lands on that site's own tab. */
export async function aReadableSmocSiteLandsOnItsTab(): Promise<void> {
  renderRedirect(ADMIN_ITEMS);
  expect(
    await screen.findByText(`landed on /control-room/site/${SMOC_SITE_ID}/hvac`),
  ).toBeTruthy();
}

/** R2 — a list without RSMOC-WC (a PHE-only caller) lands on `/control-room` (OQ4). */
export async function aListWithoutTheSmocSiteLandsOnTheControlRoom(): Promise<void> {
  renderRedirect(PHE_ONLY_ITEMS);
  expect(await screen.findByText("landed on /control-room")).toBeTruthy();
}

/** R3a — while the read is pending, a status line renders. */
export function aPendingReadShowsAStatusLine(): void {
  renderRedirect("pending");
  expect(screen.getByRole("status").textContent).toBe("Opening the Control Room…");
}

/** R3b — while the read is pending, the caller stays on the `/cr-*` path. */
export async function aPendingReadDoesNotNavigate(): Promise<void> {
  renderRedirect("pending");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByText(/landed on/)).toBeNull();
  expect(screen.getByRole("status")).toBeTruthy();
}

/** R4 — a failed read lands on `/control-room`, never on a tab (OQ4). */
export async function aFailedReadLandsOnTheControlRoom(): Promise<void> {
  renderRedirect("rejected");
  expect(await screen.findByText("landed on /control-room")).toBeTruthy();
}

/** R5 — every read is stubbed: after a redirect, nothing reached `fetch`. */
export async function noReadReachesTheNetwork(): Promise<void> {
  renderRedirect(ADMIN_ITEMS);
  await screen.findByText(/landed on/);
  expect(locationsApi.fetchLocationKpis).toHaveBeenCalledTimes(1);
}

/** Unmounts, restores the spies, and fails the case if a read reached the network. */
export function cleanupRedirect(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(networkCalls, "a read reached the network").toEqual([]);
}
