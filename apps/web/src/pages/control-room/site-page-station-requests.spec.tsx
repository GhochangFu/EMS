import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import type { DashboardDto, DashboardSummaryDto, LocationKpiSummary, ResolvedSiteControlRoomViewDto } from "@bms/shared";

import { useAuthStore } from "../../stores/auth-store";
import { site, USER } from "./organizations-page.spec";
import { ControlRoomSitePage } from "./site-page";

/**
 * `F4.240` part b (ADR 0140 decisions 3, 5; plan Task 1.7) — the request tripwire. The station
 * page must read the station only through the reads that walk its subtree after refusing an
 * unreadable node, and never through a read that would price, generate or chart the station
 * itself.
 *
 * **No API module is mocked**: every component on the page runs its real read. `fetch` is a
 * recording stub that answers the KPI list, the station's resolve, the dashboards list and one
 * detail with valid bodies, and `{}` to everything else (a card then shows its error state, which
 * is not the claim). `socket.io-client` is mocked so the rail's socket stays in the process (the
 * `active-alarms-rail.spec.tsx` precedent).
 *
 * The allow-list is wider than ADR 0140's sentence by `/dashboards` (decision 3h's list). The
 * findings paragraph (`/ml/findings/paragraph`) joins it only when a summary holds findings; the
 * `{}` answers here hold none, so it is not requested.
 *
 * `F4.240` part b PR 2 (plan Task 2.6): the site halves read each site (T1–T2 with generated
 * sites, T4 with dashboard sites), and `/trends` reads the subtree energy views and one bill per
 * site (T5).
 *
 * Assertions live here; `site-page-station-requests.test.tsx` is the Vitest entry point and carries
 * the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 */

vi.mock("socket.io-client", () => ({
  io: () => ({
    on: () => undefined,
    off: () => undefined,
    emit: () => undefined,
    connect: () => undefined,
    disconnect: () => undefined,
  }),
}));

const ORG = { id: "10000000-0000-4000-8000-000000000001", code: "PHEWB", name: "PHEWB" };
const OTHER_ORG = { id: "10000000-0000-4000-8000-000000000002", code: "BBB", name: "Beta Works" };
const ST = "20000000-0000-4000-8000-000000000001";
const ST_1 = "20000000-0000-4000-8000-000000000002";
const ST_2 = "20000000-0000-4000-8000-000000000003";

const ITEMS: LocationKpiSummary[] = [
  site({ id: ST, name: "Lotapata", organization: ORG, assetCount: 0, totalKw: null }),
  { ...site({ id: ST_1, name: "Lotapata I", organization: ORG, assetCount: 4, freshAssetCount: 4, totalKw: 20.5 }), parentId: ST },
  { ...site({ id: ST_2, name: "Lotapata II", organization: ORG, assetCount: 4, totalKw: 20.7 }), parentId: ST },
  site({ id: "30000000-0000-4000-8000-000000000001", name: "Beta One", organization: OTHER_ORG }),
];

const VIEW: ResolvedSiteControlRoomViewDto = {
  locationId: ST,
  kind: "generated",
  dashboardId: null,
  dashboardSlug: null,
  builtinKey: null,
  notice: "no_site_layout",
};

const STAMP = {
  id: "40000000-0000-4000-8000-000000000001",
  organizationId: ORG.id,
  slug: "lotapata-site",
  name: "Lotapata site",
  description: null,
  locationId: ST,
  assetGroupId: null,
  assetId: null,
  assetTemplateId: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const SUMMARY: DashboardSummaryDto = {
  ...STAMP,
  assetCode: null,
  assetRtuName: null,
  assetLocationName: null,
  widgetCount: 0,
};

const DETAIL: DashboardDto = {
  ...STAMP,
  templateId: "50000000-0000-4000-8000-000000000001",
  tabs: [],
  widgets: [],
};

/**
 * `F4.240` part b PR 2 (plan Task 2.6) — T4's two dashboard sites: each site's view is a
 * `dashboard`, and its dashboard holds one site widget (`asset_class_strip`, which reads the site widgets) and one trend strip on its
 * one tab, so each half mounts the live canvas and its two reads. T1–T3 and T5 leave this off,
 * and the site resolves answer `generated`, so each half mounts the site's generated view and its
 * read, which T2 holds to the sites.
 */
let dashboardSites = false;

function siteDashboard(n: 1 | 2, locationId: string): DashboardDto {
  const id = `6000000${n}-0000-4000-8000-000000000001`;
  const tabId = `6000000${n}-0000-4000-8000-000000000002`;
  const widget = {
    dashboardId: id,
    organizationId: ORG.id,
    tabId,
    title: null,
    gridX: 0,
    gridW: 12,
    gridH: 4,
    points: [],
    sources: [],
  };
  return {
    ...STAMP,
    id,
    slug: `lotapata-${n}-site`,
    name: `Lotapata ${n} site`,
    locationId,
    templateId: null,
    tabs: [{ id: tabId, dashboardId: id, organizationId: ORG.id, key: "overview", label: "Overview", sortOrder: 0, assetGroupId: null }],
    widgets: [
      { ...widget, id: `6000000${n}-0000-4000-8000-000000000003`, gridY: 0, widgetType: "asset_class_strip", config: {} },
      {
        ...widget,
        id: `6000000${n}-0000-4000-8000-000000000004`,
        gridY: 4,
        widgetType: "trend_strip",
        config: { defaultRange: "24h" },
      },
    ],
  };
}

const SITE_DASHBOARDS = [siteDashboard(1, ST_1), siteDashboard(2, ST_2)] as const;

function siteView(dashboard: DashboardDto): ResolvedSiteControlRoomViewDto {
  return {
    locationId: dashboard.locationId as string,
    kind: "dashboard",
    dashboardId: dashboard.id,
    dashboardSlug: dashboard.slug,
    builtinKey: null,
    notice: null,
  };
}

let fetchSpy: Mock | null = null;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function answer(url: URL): Response {
  const path = url.pathname.replace(/^\/api\/v1/, "");
  if (path === "/dashboard/locations") return json({ items: ITEMS });
  if (path === `/control-room/sites/${ST}/view`) return json(VIEW);
  if (path === "/dashboards") return json({ items: [SUMMARY] });
  if (path === `/dashboards/${SUMMARY.slug}`) return json(DETAIL);
  for (const dashboard of SITE_DASHBOARDS) {
    if (path === `/control-room/sites/${dashboard.locationId}/view`) {
      return json(dashboardSites ? siteView(dashboard) : { ...VIEW, locationId: dashboard.locationId, notice: null });
    }
    if (dashboardSites && path === `/dashboards/${dashboard.slug}`) return json(dashboard);
  }
  return json({});
}

function stubFetch(): void {
  fetchSpy = vi.fn((input: RequestInfo | URL) => Promise.resolve(answer(new URL(String(input)))));
  vi.stubGlobal("fetch", fetchSpy);
  useAuthStore.setState({ scope: { kind: "global", locations: [], assetGroups: [], assetIds: [] } });
}

function requested(): URL[] {
  return (fetchSpy?.mock.calls ?? []).map((call) => new URL(String(call[0])));
}

/** The pathnames (without `/api/v1`) of the requests that name the station, in the path or in a parameter. */
function stationPaths(): string[] {
  const paths = requested()
    .filter((url) => url.pathname.includes(ST) || [...url.searchParams.values()].includes(ST))
    .map((url) => url.pathname.replace(/^\/api\/v1/, "").replaceAll(ST, "<st>"));
  return [...new Set(paths)].sort();
}

function renderAt(path: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/control-room/site/:locationId/:tab?" element={<ControlRoomSitePage user={USER} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ALLOWED = [
  "/alarms",
  "/alarms/summary",
  "/asset-health/bad-actors",
  "/control-room/sites/<st>/view",
  "/dashboards",
  "/degradation",
  "/ml/anomalies/summary",
  "/ml/forecasts/summary",
].sort();

/** Waits for the station heading and for every lower card's request, then lets the page settle. */
async function settledStation(): Promise<void> {
  await screen.findByRole("heading", { level: 1, name: "Lotapata" });
  await waitFor(() => expect(stationPaths()).toEqual(expect.arrayContaining(ALLOWED)));
  await waitFor(() =>
    expect(requested().some((url) => url.pathname.endsWith(`/dashboards/${SUMMARY.slug}`))).toBe(true),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/** T1 — the bare path: the requests that name the station are exactly the allow-list. */
export async function theStationReadsOnlyTheSubtreeReads(): Promise<void> {
  stubFetch();
  renderAt(`/control-room/site/${ST}`);
  await settledStation();

  expect(stationPaths()).toEqual(ALLOWED);
}

/** T2 — none of the station-itself reads was made; each is named in its own message. */
export async function theStationMakesNoStationItselfRead(): Promise<void> {
  stubFetch();
  renderAt(`/control-room/site/${ST}`);
  await settledStation();

  const paths = stationPaths();
  for (const forbidden of [
    "/locations/<st>/energy-bill",
    "/dashboard/locations/<st>",
    "/control-room/sites/<st>/generated",
    "/control-room/sites/<st>/trend-strip",
    "/control-room/sites/<st>/segment-views",
  ]) {
    expect(paths, `the station page requested ${forbidden}`).not.toContain(forbidden);
  }
}

/** T3 — `/assets` at the station: the only request that names the station is the resolve. */
export async function theStationAssetsReadsOnlyTheResolve(): Promise<void> {
  stubFetch();
  renderAt(`/control-room/site/${ST}/assets`);
  await screen.findByRole("heading", { level: 1, name: "Lotapata" });
  // The waitFor confirms the resolve was requested; the 100 ms wait then lets the body render.
  // No wait on the section's own markup, so a body that reads the station still reaches the
  // assertion.
  await waitFor(() => expect(stationPaths()).toContain("/control-room/sites/<st>/view"));
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect(stationPaths()).toEqual(["/control-room/sites/<st>/view"]);
}

/** The pathnames (without `/api/v1`) of every request whose path ends in `suffix`, ids kept. */
function pathsEndingIn(suffix: string): string[] {
  const paths = requested()
    .map((url) => url.pathname.replace(/^\/api\/v1/, ""))
    .filter((path) => path.endsWith(suffix));
  return [...new Set(paths)].sort();
}

/**
 * T4 (PR 2) — the bare path with two dashboard sites: the station-naming set is still exactly T1's,
 * and each half's live reads name only its own site: the site-widgets reads name the two sites'
 * dashboards, and the trend-strip reads the two sites. Mutation: resolve a half at the station's
 * id => red. Handing an embedded half the station's id as its `locationId` changes no request (the
 * canvas reads the dashboard's own location; the id only built the strip and the redirect, both
 * off when embedded), so that one is not a mutation this case can see.
 */
export async function bothHalvesReadOnlyTheirOwnSite(): Promise<void> {
  dashboardSites = true;
  stubFetch();
  renderAt(`/control-room/site/${ST}`);
  await settledStation();
  await waitFor(() => expect(pathsEndingIn("/site-widgets")).toHaveLength(2));
  await waitFor(() => expect(pathsEndingIn("/trend-strip")).toHaveLength(2));
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(stationPaths()).toEqual(ALLOWED);
  expect(pathsEndingIn("/site-widgets")).toEqual(
    SITE_DASHBOARDS.map((dashboard) => `/dashboards/${dashboard.id}/site-widgets`).sort(),
  );
  expect(pathsEndingIn("/trend-strip")).toEqual([ST_1, ST_2].map((id) => `/control-room/sites/${id}/trend-strip`).sort());
  expect(pathsEndingIn("/view").filter((path) => path.startsWith("/control-room/sites/"))).toEqual(
    [ST, ST_1, ST_2].map((id) => `/control-room/sites/${id}/view`).sort(),
  );
}

/**
 * T5 (PR 2) — `/trends`: the station is named only by the resolve and the two subtree energy reads;
 * each site's bill is requested once, the station's never; no segment read names the station.
 * Mutation: drop `billSlot` in `StationEnergyView` => the station's own bill is read => red.
 */
export async function theStationTrendsReadsOnlyTheEnergyViewsAndTheSiteBills(): Promise<void> {
  stubFetch();
  renderAt(`/control-room/site/${ST}/trends`);
  await screen.findByRole("heading", { level: 1, name: "Lotapata" });
  await waitFor(() =>
    expect(stationPaths()).toEqual(
      expect.arrayContaining(["/reports/energy/view", "/reports/energy/organization-views"]),
    ),
  );
  await waitFor(() => expect(pathsEndingIn("/energy-bill")).toHaveLength(2));
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect(stationPaths()).toEqual(
    ["/control-room/sites/<st>/view", "/reports/energy/organization-views", "/reports/energy/view"].sort(),
  );
  const bills = requested()
    .map((url) => url.pathname.replace(/^\/api\/v1/, ""))
    .filter((path) => path.endsWith("/energy-bill"))
    .sort();
  expect(bills).toEqual([ST_1, ST_2].map((id) => `/locations/${id}/energy-bill`).sort());
  expect(requested().filter((url) => url.pathname.includes("segment-views") && url.pathname.includes(ST))).toEqual([]);
}

export function cleanupRequests(): void {
  cleanup();
  dashboardSites = false;
  fetchSpy = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ scope: null });
}
