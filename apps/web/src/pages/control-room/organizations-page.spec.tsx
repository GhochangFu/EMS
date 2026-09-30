import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { expect, vi } from "vitest";

import { locationKpiSummarySchema } from "@bms/shared/contracts";
import type { LocationKpiSummary } from "@bms/shared";

import * as assetsApi from "../../api/assets";
import * as locationsApi from "../../api/locations";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import type { AuthUser } from "../../stores/auth-store";
import * as dashboardPage from "../dashboard-page";
import * as organizationPage from "./organization-page";
import { ControlRoomOrganizationsPage } from "./organizations-page";
import * as sitePage from "./site-page";

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
 * sidebar and top navigation hold links of their own (the top-nav Overview
 * links to `/`), so an unscoped link query can pass with no empty card at all.
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

/** Where the router is, so "the URL stays `/`" (OQ2) is observable. */
function PathnameProbe() {
  return <span data-testid="pathname">{useLocation().pathname}</span>;
}

/**
 * `F3.72` (plan D1) — stand-ins for the three levels the page renders in
 * place. Each is spied inside the case that needs it, never `vi.mock`ed at
 * module level: this spec's fixtures are imported by four sibling specs, and
 * a module mock here would replace the real pages there too. Each stand-in
 * prints the id it received, so a case proves the id arrived.
 */
function stubLevels(): void {
  vi.spyOn(dashboardPage, "DashboardPage").mockImplementation(({ user }) => (
    <p>estate for {user.email}</p>
  ));
  vi.spyOn(organizationPage, "ControlRoomOrganizationPage").mockImplementation(({ organizationId }) => (
    <p>organization level {organizationId ?? "(no id)"}</p>
  ));
  vi.spyOn(sitePage, "ControlRoomSitePage").mockImplementation(({ locationId }) => (
    <p>site level {locationId ?? "(no id)"}</p>
  ));
}

function renderPage(opts: { entry?: boolean } = {}): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const entry = opts.entry === true;
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry ? "/" : "/control-room"]}>
        <PathnameProbe />
        <Routes>
          <Route path="/" element={entry ? <ControlRoomOrganizationsPage user={USER} entry /> : <p>root</p>} />
          <Route path="/control-room" element={<ControlRoomOrganizationsPage user={USER} />} />
          <Route path="/control-room/org/:organizationId" element={<LandedOnOrg />} />
          <Route path="/control-room/site/:locationId" element={<LandedOnSite />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const TWO_ORGANIZATIONS = (): LocationKpiSummary[] => [
  site({ id: "a1", name: "Alpha One", organization: ORG_A }),
  site({ id: "b1", name: "Beta One", organization: ORG_B }),
];

/**
 * O1 — `F3.72` (plan D1): two organizations at `/control-room` render the
 * estate (`DashboardPage`), which holds the organization cards
 * (`dashboard-page.spec.tsx` asserts them). The page returns the estate
 * **instead of** its own shell: no sidebar and no "Choose an organization"
 * header of its own around the stand-in, which renders neither.
 */
export async function theOrganizationsLevelRendersTheEstate(): Promise<void> {
  stubShell();
  stubLevels();
  stubLocations(TWO_ORGANIZATIONS());
  renderPage();

  expect(await screen.findByText("estate for admin@bms.local")).toBeInTheDocument();
  expect(screen.queryByText("Choose an organization to open its sites")).toBeNull();
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(screen.queryByText(/landed on/)).toBeNull();
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

/**
 * O5a — no readable site: the OQ3 card, and no link in it. `F3.72` removed
 * its "Back to the dashboard" link to `/`: `/` now renders this same card
 * for an empty scope. The card's text is the positive control.
 */
export async function anEmptyScopeShowsTheNoSitesCard(): Promise<void> {
  stubShell();
  stubLocations([]);
  renderPage();

  const text = await screen.findByText("Ask an administrator for access to a site.");
  const card = text.closest("section");
  expect(card, "the empty text is not inside a SectionCard").not.toBeNull();
  expect(within(card as HTMLElement).getByText("No sites in your access scope")).toBeInTheDocument();
  expect(within(card as HTMLElement).queryAllByRole("link")).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// `F3.72` (plan D1, OQ2) — `entry`: at `/` the page renders the caller's
// entry level in place. The URL stays `/`; nothing redirects.
// ---------------------------------------------------------------------------

/** One organization with two sites: the organization level, with its id, at `/`. */
export async function entryRendersTheOrganizationInPlace(): Promise<void> {
  stubShell();
  stubLevels();
  stubLocations([
    site({ id: "a1", name: "Alpha One", organization: ORG_A }),
    site({ id: "a2", name: "Alpha Two", organization: ORG_A }),
  ]);
  renderPage({ entry: true });

  expect(await screen.findByText("organization level org-a")).toBeInTheDocument();
  expect(screen.getByTestId("pathname").textContent).toBe("/");
  expect(screen.queryByText(/landed on/)).toBeNull();
  expect(screen.queryByRole("complementary")).toBeNull();
}

/** One site: the site level, with its id, at `/`. */
export async function entryRendersTheSiteInPlace(): Promise<void> {
  stubShell();
  stubLevels();
  stubLocations([site({ id: "a1", name: "Alpha One", organization: ORG_A })]);
  renderPage({ entry: true });

  expect(await screen.findByText("site level a1")).toBeInTheDocument();
  expect(screen.getByTestId("pathname").textContent).toBe("/");
  expect(screen.queryByText(/landed on/)).toBeNull();
  expect(screen.queryByRole("complementary")).toBeNull();
}

/** Two organizations: the estate, at `/`, with no shell of the page's own around it. */
export async function entryRendersTheEstateForManyOrganizations(): Promise<void> {
  stubShell();
  stubLevels();
  stubLocations(TWO_ORGANIZATIONS());
  renderPage({ entry: true });

  expect(await screen.findByText("estate for admin@bms.local")).toBeInTheDocument();
  expect(screen.getByTestId("pathname").textContent).toBe("/");
  expect(screen.queryByRole("complementary")).toBeNull();
}

/**
 * No readable site: the no-sites card, **without** the "Back to the
 * dashboard" link — at `/` it would link to itself. The card's own text is
 * the positive control that the card rendered.
 */
export async function entryShowsTheNoSitesCardWithoutABackLink(): Promise<void> {
  stubShell();
  stubLevels();
  stubLocations([]);
  renderPage({ entry: true });

  const text = await screen.findByText("Ask an administrator for access to a site.");
  const card = text.closest("section");
  expect(card, "the empty text is not inside a SectionCard").not.toBeNull();
  expect(within(card as HTMLElement).getByText("No sites in your access scope")).toBeInTheDocument();
  expect(within(card as HTMLElement).queryAllByRole("link")).toHaveLength(0);
  expect(screen.getByTestId("pathname").textContent).toBe("/");
}

/** While the read is pending: the status line, and no level rendered (D1). */
export async function entryDecidesNothingWhilePending(): Promise<void> {
  stubShell();
  stubLevels();
  vi.spyOn(locationsApi, "fetchLocationKpis").mockReturnValue(new Promise(() => undefined));
  renderPage({ entry: true });

  const status = await screen.findByRole("status");
  expect(status.textContent).toBe("Loading Control Room…");
  expect(screen.queryByText(/estate for|organization level|site level|landed on/)).toBeNull();
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
