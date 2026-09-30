import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { expect, vi } from "vitest";

import { locationKpiSummarySchema } from "@bms/shared/contracts";
import type { LocationKpiSummary } from "@bms/shared";

import * as assetsApi from "../../api/assets";
import * as locationsApi from "../../api/locations";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import type { AuthUser } from "../../stores/auth-store";
import { ControlRoomOrganizationsPage } from "./organizations-page";

/**
 * `F3.66` U3 — `/control-room`, the organization list (ADR 0076 decision 2),
 * rows O1–O6 of the plan's U3 table, plus E1 (the error card).
 *
 * Assertions live here; `organizations-page.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014,
 * ADR 0042 decision 2).
 *
 * The page renders inside `AppShell`, so every case stubs what the shell reads
 * on mount: `fetchSystemStatus` (`F4.160` — an unstubbed read reaches a local
 * API on `:4000`). `fetchAssets` is stubbed too: the shell called it until
 * `F3.66` U6, and the stub keeps any stray read inside the process. The
 * fixtures here are exported for `organization-page.spec.tsx`.
 *
 * Every link and label query is scoped to its own container: the shell's
 * sidebar holds a link to `/`, so an unscoped "a link to `/`" passes with no
 * empty card at all.
 */

export const ORG_A = { id: "org-a", code: "AAA", name: "Alpha Utilities" };
export const ORG_B = { id: "org-b", code: "BBB", name: "Beta Works" };

export function site(opts: {
  id: string;
  name: string;
  organization: { id: string; code: string; name: string };
  code?: string;
  assetCount?: number;
  freshAssetCount?: number;
  openAlarms?: number;
}): LocationKpiSummary {
  return locationKpiSummarySchema.parse({
    id: opts.id,
    name: opts.name,
    code: opts.code ?? `SITE-${opts.id}`,
    type: "smoc_campus",
    typeLabel: "SMOC campus",
    province: null,
    organization: opts.organization,
    rtuCount: 0,
    assetCount: opts.assetCount ?? 3,
    freshAssetCount: opts.freshAssetCount ?? 0,
    totalKw: 0,
    openAlarms: opts.openAlarms ?? 0,
    criticalAlarms: 0,
    scopeLabel: "full",
  });
}

export const USER: AuthUser = {
  id: "u1",
  email: "admin@bms.local",
  displayName: "Admin",
  role: "admin",
} as unknown as AuthUser;

/** The shell's status read, and `fetchAssets`, stubbed so no case leaves the process. */
export function stubShell(): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
}

export function stubLocations(items: LocationKpiSummary[]): void {
  vi.spyOn(locationsApi, "fetchLocationKpis").mockResolvedValue({ items });
}

/** A redirect target, so a `<Navigate>` is observable. */
function LandedOnOrg() {
  const { organizationId } = useParams();
  return <p>landed on org {organizationId}</p>;
}

function LandedOnSite() {
  const { locationId } = useParams();
  return <p>landed on site {locationId}</p>;
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/control-room"]}>
        <Routes>
          <Route path="/control-room" element={<ControlRoomOrganizationsPage user={USER} />} />
          <Route path="/control-room/org/:organizationId" element={<LandedOnOrg />} />
          <Route path="/control-room/site/:locationId" element={<LandedOnSite />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * O1 — two organizations render the card grid, one card per organization. The
 * card content and links (the old O1 and O2) moved to
 * `components/control-room/organization-card-grid.spec.tsx` with the grid
 * (`F3.72` U1); this case holds only that the page hands its items to the grid.
 */
export async function twoOrganizationsRenderTheCardGrid(): Promise<void> {
  stubShell();
  stubLocations([
    site({ id: "a1", name: "Alpha One", organization: ORG_A }),
    site({ id: "b1", name: "Beta One", organization: ORG_B }),
  ]);
  renderPage();

  const grid = await screen.findByTestId("control-room-organizations");
  const hrefs = Array.from(grid.querySelectorAll("a")).map((a) => a.getAttribute("href"));
  expect(hrefs).toEqual(["/control-room/org/org-a", "/control-room/org/org-b"]);
}

/** O3 — one organization with two sites skips to the organization level. */
export async function oneOrganizationSkipsToIt(): Promise<void> {
  stubShell();
  stubLocations([
    site({ id: "a1", name: "Alpha One", organization: ORG_A }),
    site({ id: "a2", name: "Alpha Two", organization: ORG_A }),
  ]);
  renderPage();

  expect(await screen.findByText("landed on org org-a")).toBeInTheDocument();
}

/** O4 — one organization with one site skips to the site. */
export async function oneSiteSkipsToTheSite(): Promise<void> {
  stubShell();
  stubLocations([site({ id: "a1", name: "Alpha One", organization: ORG_A })]);
  renderPage();

  expect(await screen.findByText("landed on site a1")).toBeInTheDocument();
}

/** O5a — no readable site: the OQ3 card, with its own link to `/`. */
export async function anEmptyScopeShowsTheNoSitesCard(): Promise<void> {
  stubShell();
  stubLocations([]);
  renderPage();

  const text = await screen.findByText(/No sites in your access scope/);
  const card = text.closest("section");
  expect(card, "the empty text is not inside a SectionCard").not.toBeNull();
  const link = within(card as HTMLElement).getByRole("link");
  expect(link.getAttribute("href")).toBe("/");
}

/** O5b — after the empty card renders, nothing redirected. */
export async function anEmptyScopeDoesNotRedirect(): Promise<void> {
  stubShell();
  stubLocations([]);
  renderPage();

  expect(await screen.findByText(/No sites in your access scope/)).toBeInTheDocument();
  expect(screen.queryByText(/landed on/)).toBeNull();
}

/** O6 — while the read is pending: the status line, and no decision (D1). */
export async function aPendingReadDecidesNothing(): Promise<void> {
  stubShell();
  vi.spyOn(locationsApi, "fetchLocationKpis").mockReturnValue(new Promise(() => undefined));
  renderPage();

  const status = await screen.findByRole("status");
  expect(status.textContent).toBe("Loading Control Room…");
  expect(screen.queryByText(/landed on/)).toBeNull();
}

/** E1 — a failed first read shows the unavailable card, not the loading line. */
export async function aFailedReadShowsTheUnavailableCard(): Promise<void> {
  stubShell();
  vi.spyOn(locationsApi, "fetchLocationKpis").mockRejectedValue(new Error("dashboard 500"));
  renderPage();

  expect(await screen.findByText("Control Room unavailable")).toBeInTheDocument();
}

export function cleanupPage(): void {
  cleanup();
  vi.restoreAllMocks();
}
