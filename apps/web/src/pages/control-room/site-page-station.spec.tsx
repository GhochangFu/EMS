import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import type { DashboardDto, LocationKpiSummary, ResolvedSiteControlRoomViewDto } from "@bms/shared";

import * as assetsApi from "../../api/assets";
import * as controlRoomApi from "../../api/control-room";
import * as copilotApi from "../../api/copilot";
import * as dashboardsApi from "../../api/dashboards";
import * as locationsApi from "../../api/locations";
import * as systemStatusApi from "../../api/system-status";
import { SiteCardGroups } from "../../components/control-room/site-card-groups";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { groupSitesByParent } from "../../lib/location-kpi-groups";
import { siteAssetsPath } from "../../lib/smoc-pages";
import { useAuthStore } from "../../stores/auth-store";
import { ORG_B, site, USER } from "./organizations-page.spec";
import { ControlRoomSitePage } from "./site-page";

/**
 * `F4.240` part b (ADR 0140 decisions 1–4, 6; plan Task 1.6) — the site page at a **station**: a
 * location that holds no asset and heads a group of sites (`stationGroupOf`). The harness is
 * `site-page-polling.spec.tsx`'s. Leaf components are stand-ins that record their props as data
 * attributes (the `site-page.spec.tsx` precedent); `StationView`, the site cards and the crumbs are
 * real. `fetch` is a spy, and the cleanup fails the case if anything reached it.
 *
 * Assertions live here; `site-page-station.test.tsx` is the Vitest entry point and carries the
 * `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 */

vi.mock("../../components/ml/ml-findings-card", () => ({
  MlFindingsCard: (props: { scope: unknown }) => <div data-testid="ml-findings-card" data-scope={JSON.stringify(props.scope)} />,
}));
vi.mock("../../components/asset-health/health-bad-actors-card", () => ({
  HealthBadActorsCard: (props: { organizationId?: string; locationId?: string; showCount?: boolean }) => (
    <div
      data-testid="health-bad-actors-card"
      data-organization-id={props.organizationId ?? ""}
      data-location-id={props.locationId ?? ""}
      data-show-count={String(props.showCount ?? false)}
    />
  ),
}));
vi.mock("../../components/degradation/degradation-trend-card", () => ({
  DegradationTrendCard: (props: { organizationId?: string; locationId?: string }) => (
    <div
      data-testid="degradation-trend-card"
      data-organization-id={props.organizationId ?? ""}
      data-location-id={props.locationId ?? ""}
    />
  ),
}));
vi.mock("../../components/control-room/active-alarms-rail", () => ({
  ActiveAlarmsRail: (props: Record<string, unknown>) => (
    <div data-testid="active-alarms-rail" data-props={JSON.stringify(props)} />
  ),
}));
vi.mock("../../components/control-room/scoped-dashboards-list", () => ({
  ScopedDashboardsList: (props: { organizationId?: string; locationId?: string; omitTemplateCopies?: boolean }) => (
    <div
      data-testid="scoped-dashboards-list"
      data-organization-id={props.organizationId ?? ""}
      data-location-id={props.locationId ?? ""}
      data-omit-template-copies={String(props.omitTemplateCopies ?? false)}
    />
  ),
}));
vi.mock("../../components/control-room/generated-site-view", () => ({
  GeneratedSiteView: (props: { locationId: string }) => (
    <div data-testid="generated-site-view" data-location-id={props.locationId} />
  ),
}));
vi.mock("../../components/control-room/site-assets-view", () => ({
  SiteAssetsView: () => <div data-testid="site-assets-view" />,
}));
vi.mock("../../components/control-room/site-trends-view", () => ({
  SiteTrendsView: () => <div data-testid="site-trends-view" />,
}));
vi.mock("../../components/control-room/smoc-site-view", () => ({ SmocSiteView: () => null }));
vi.mock("../../components/control-room/site-dashboard-view", () => ({
  SiteDashboardView: (props: { locationId: string; tab?: string }) => (
    <div data-testid="site-dashboard-view" data-location-id={props.locationId} data-tab={props.tab ?? ""} />
  ),
}));
vi.mock("../../components/control-room/replace-site-layout-wizard", () => ({ ReplaceSiteLayoutWizard: () => null }));
vi.mock("../../components/control-room/site-layout-wizard", () => ({
  SiteLayoutWizard: () => <div data-testid="site-layout-wizard" />,
}));
vi.mock("../../api/trend-strip", () => ({
  fetchSiteTrendStrip: () => new Promise(() => undefined),
}));

const ORG_PHE = { id: "org-phewb", code: "PHEWB", name: "PHEWB" };

function withFields(item: LocationKpiSummary, fields: Partial<LocationKpiSummary>): LocationKpiSummary {
  return { ...item, ...fields };
}

/**
 * PHEWB: `Lotapata` holds no asset and heads `Lotapata I` (live, 4 assets, 2 alarms, 20.5 kW) and
 * `Lotapata II` (4 assets, 1 alarm, 20.7 kW); `Holder` holds assets and has a child; a second
 * organization. The station's own figures are chosen so a total read from its own item reddens.
 */
const ITEMS: LocationKpiSummary[] = [
  site({ id: "st", name: "Lotapata", organization: ORG_PHE, assetCount: 0, totalKw: null }),
  withFields(
    site({ id: "st-1", name: "Lotapata I", organization: ORG_PHE, assetCount: 4, freshAssetCount: 4, openAlarms: 2, totalKw: 20.5 }),
    { parentId: "st", rtuCount: 1 },
  ),
  withFields(site({ id: "st-2", name: "Lotapata II", organization: ORG_PHE, assetCount: 4, openAlarms: 1, totalKw: 20.7 }), {
    parentId: "st",
    rtuCount: 2,
  }),
  site({ id: "h", name: "Holder", organization: ORG_PHE, assetCount: 2 }),
  withFields(site({ id: "h-1", name: "Holder Child", organization: ORG_PHE }), { parentId: "h" }),
  site({ id: "b1", name: "Beta One", organization: ORG_B }),
];

function view(locationId: string, fields: Partial<ResolvedSiteControlRoomViewDto> = {}): ResolvedSiteControlRoomViewDto {
  return {
    locationId,
    kind: "generated",
    dashboardId: null,
    dashboardSlug: null,
    builtinKey: null,
    notice: null,
    ...fields,
  };
}

let fetchSpy: Mock | null = null;

/**
 * `answer` is the resolve for its own `locationId`; every other id (the station's sites, read by
 * the halves since PR 2) resolves to `generated` unless `others` names it, so a station answer never
 * leaks into a site half.
 */
function stubReads(
  items: readonly LocationKpiSummary[],
  answer: ResolvedSiteControlRoomViewDto | "reject",
  others: Record<string, ResolvedSiteControlRoomViewDto> = {},
): void {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  useAuthStore.setState({ scope: { kind: "global", locations: [], assetGroups: [], assetIds: [] } });
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(locationsApi, "fetchLocationKpis").mockResolvedValue({ items: [...items] });
  const resolve = vi.spyOn(controlRoomApi, "fetchResolvedSiteControlRoomView");
  if (answer === "reject") {
    resolve.mockRejectedValue(new Error("control-room/site-view 404"));
  } else {
    resolve.mockImplementation((id: string) =>
      Promise.resolve(id === answer.locationId ? answer : (others[id] ?? view(id))),
    );
  }
}

/** The `cleanupStation` network check, for a case that cleans up and re-stubs half-way. */
function expectNoNetworkSoFar(): void {
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  expect(networkCalls, "a read reached the network").toEqual([]);
}

function PathnameProbe() {
  const { pathname } = useLocation();
  return <p data-testid="pathname">{pathname}</p>;
}

function renderAt(path: string): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <PathnameProbe />
        <Routes>
          <Route path="/control-room/site/:locationId/:tab?" element={<ControlRoomSitePage user={USER} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

async function stationHeading(name = "Lotapata"): Promise<HTMLElement> {
  return screen.findByRole("heading", { level: 1, name });
}

function cardHrefs(root: ParentNode = document): (string | null)[] {
  return Array.from(root.querySelectorAll("a[data-live]")).map((a) => a.getAttribute("href"));
}

function crumbs(): HTMLElement {
  return screen.getByRole("navigation", { name: "Breadcrumb" });
}

/** ST1 — the station URL: heading, subtitle, crumbs, two site cards; no generated view, no notice. */
export async function theStationUrlRendersTheStation(): Promise<void> {
  stubReads(ITEMS, view("st", { notice: "no_site_layout" }));
  renderAt("/control-room/site/st");

  await stationHeading();
  expect(await screen.findByTestId("station-totals")).toBeInTheDocument();
  expect(screen.getByText("PHEWB · PHEWB")).toBeInTheDocument();
  expect(crumbs().textContent?.replace(/\s+/g, " ").trim()).toBe("Control Room/PHEWB/Lotapata");
  expect(cardHrefs()).toEqual(["/control-room/site/st-1", "/control-room/site/st-2"]);
  // PR 2: the halves draw each site's generated view; none is drawn for the station itself.
  await waitFor(() =>
    expect(screen.getAllByTestId("generated-site-view").map((el) => el.getAttribute("data-location-id"))).toEqual([
      "st-1",
      "st-2",
    ]),
  );
  expect(screen.queryByTestId("site-view-notice-box")).toBeNull();
  expect(screen.queryByTestId("site-layout-wizard")).toBeNull();
}

/** ST2 — a leaf renders the site page: the generated stand-in, and no station totals. */
export async function aLeafRendersTheSitePage(): Promise<void> {
  stubReads(ITEMS, view("st-1"));
  renderAt("/control-room/site/st-1");

  expect(await screen.findByTestId("generated-site-view")).toBeInTheDocument();
  expect(screen.queryByTestId("station-totals")).toBeNull();
}

/** ST3 — a parent that holds assets renders the site page too. */
export async function aParentThatHoldsAssetsRendersTheSitePage(): Promise<void> {
  stubReads(ITEMS, view("h"));
  renderAt("/control-room/site/h");

  expect(await screen.findByTestId("generated-site-view")).toBeInTheDocument();
  expect(screen.queryByTestId("station-totals")).toBeNull();
}

/** ST4 — the totals line is the header's roll-up sentence plus the sites' kW, one decimal. */
export async function theTotalsLineIsTheHeadersSentenceAndTheKw(): Promise<void> {
  stubReads(ITEMS, view("st"));
  renderAt("/control-room/site/st");

  const totals = await screen.findByTestId("station-totals");
  expect(totals.textContent).toBe("1 of 2 sites live · 8 assets · 3 alarms · 41.2 kW");

  const { container } = render(
    <MemoryRouter>
      <SiteCardGroups grouped={groupSitesByParent(ITEMS)} />
    </MemoryRouter>,
  );
  const header = within(container.querySelector('[data-testid="site-group-st"]') as HTMLElement).getByTestId(
    "site-group-rollup",
  );
  expect(totals.textContent?.startsWith(`${header.textContent} · `), "the roll-up part equals the header's").toBe(true);
}

/** ST5 — the rail reads the station by `locationId`, and by nothing else. */
export async function theRailReadsTheStationLocation(): Promise<void> {
  stubReads(ITEMS, view("st"));
  renderAt("/control-room/site/st");

  const rail = await screen.findByTestId("active-alarms-rail");
  expect(JSON.parse(rail.getAttribute("data-props") ?? "null")).toEqual({ locationId: "st" });
}

/** ST6 — the advisory cards and the dashboards list carry the station and its organization. */
export async function theLowerCardsCarryTheStation(): Promise<void> {
  stubReads(ITEMS, view("st"));
  renderAt("/control-room/site/st");

  const ml = await screen.findByTestId("ml-findings-card");
  expect(JSON.parse(ml.getAttribute("data-scope") ?? "null")).toEqual({ organizationId: ORG_PHE.id, locationId: "st" });
  for (const testId of ["health-bad-actors-card", "degradation-trend-card", "scoped-dashboards-list"]) {
    const card = screen.getByTestId(testId);
    expect(card.getAttribute("data-organization-id"), testId).toBe(ORG_PHE.id);
    expect(card.getAttribute("data-location-id"), testId).toBe("st");
  }
  expect(screen.getByTestId("health-bad-actors-card").getAttribute("data-show-count")).toBe("true");
  expect(screen.getByTestId("scoped-dashboards-list").getAttribute("data-omit-template-copies")).toBe("true");
}

/** ST7 — `/assets` at the station: one row per site with its counts and a link to its assets page. */
export async function theStationAssetsListsEachSite(): Promise<void> {
  stubReads(ITEMS, view("st"));
  renderAt("/control-room/site/st/assets");

  await stationHeading();
  const rows = await screen.findAllByTestId("station-site-row");
  expect(rows.map((row) => row.querySelector("a")?.getAttribute("href"))).toEqual([
    siteAssetsPath("st-1"),
    siteAssetsPath("st-2"),
  ]);
  expect(rows[0].textContent).toContain("Lotapata I");
  expect(rows[0].textContent).toContain("1 RTUs · 4 assets");
  expect(rows[1].textContent).toContain("2 RTUs · 4 assets");
  expect(screen.queryByTestId("site-assets-view")).toBeNull();
  expect(screen.queryByTestId("station-totals")).toBeNull();
}

function stripLabels(): string[] {
  const strip = screen.getByRole("navigation", { name: "Site sections" });
  return within(strip)
    .getAllByRole("link")
    .map((link) => link.textContent ?? "");
}

/**
 * ST8 (PR 2, plan D8) — a station is exempt from the page's redirect, and the halves decide: an
 * unknown segment, and `trends` until the station's own Trends & Energy arm (plan Task 2.5),
 * redirect to the bare path once the sites' reads settle; a tab a site's dashboard holds stays and
 * reaches that site's half. The strip has two entries throughout.
 */
export async function otherSegmentsRedirectAndTheStripHasTwoEntries(): Promise<void> {
  for (const segment of ["trends", "anything"]) {
    stubReads(ITEMS, view("st"));
    renderAt(`/control-room/site/st/${segment}`);
    await waitFor(() => expect(screen.getByTestId("pathname").textContent).toBe("/control-room/site/st"));
    expect(await screen.findByTestId("station-totals")).toBeInTheDocument();
    expect(screen.queryByTestId("site-trends-view")).toBeNull();
    expect(stripLabels()).toEqual(["Station view", "Assets & RTUs"]);
    expectNoNetworkSoFar();
    cleanup();
    vi.restoreAllMocks();
  }

  stubReads(ITEMS, view("st"), {
    "st-1": view("st-1", { kind: "dashboard", dashboardSlug: "st-1-site", dashboardId: "d-st-1" }),
  });
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(SITE_DASHBOARD);
  renderAt("/control-room/site/st/electrical");
  const half = await screen.findByTestId("site-dashboard-view");
  expect([half.getAttribute("data-location-id"), half.getAttribute("data-tab")]).toEqual(["st-1", "electrical"]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(screen.getByTestId("pathname").textContent).toBe("/control-room/site/st/electrical");
  expect(stripLabels()).toEqual(["Station view", "Assets & RTUs"]);
}

/** A site layout with two tabs, for ST8's third arm. */
const SITE_DASHBOARD: DashboardDto = {
  id: "d-st-1",
  organizationId: ORG_PHE.id,
  slug: "st-1-site",
  name: "Lotapata I site",
  description: null,
  locationId: "st-1",
  assetGroupId: null,
  assetId: null,
  assetTemplateId: null,
  templateId: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  tabs: ["overview", "electrical"].map((key, sortOrder) => ({
    id: `t-${key}`,
    dashboardId: "d-st-1",
    organizationId: ORG_PHE.id,
    key,
    label: key,
    sortOrder,
    assetGroupId: null,
  })),
  widgets: [],
};

/** ST9 — no Wall link; a `dashboard` resolve with `?wall=1` still renders the normal station page. */
export async function theStationHasNoWall(): Promise<void> {
  stubReads(ITEMS, view("st", { kind: "dashboard", dashboardSlug: "lotapata-site", dashboardId: "d1" }));
  renderAt("/control-room/site/st?wall=1");

  expect(await screen.findByTestId("station-totals")).toBeInTheDocument();
  expect(screen.queryByTestId("wall-clock")).toBeNull();
  expect(screen.queryByRole("link", { name: "Wall" })).toBeNull();
  // The sites resolve `generated` here, so no dashboard view is drawn, for the station or a half.
  await waitFor(() => expect(screen.getAllByTestId("generated-site-view")).toHaveLength(2));
  expect(screen.queryByTestId("site-dashboard-view")).toBeNull();
}

/** ST10 — the station absent from the list (a one-site grantee), resolve rejected: not available. */
export async function anUnreadableStationShowsTheNotAvailableCard(): Promise<void> {
  stubReads([withFields(ITEMS[1], { parentId: null })], "reject");
  renderAt("/control-room/site/st");

  expect(await screen.findByText("Site view unavailable")).toBeInTheDocument();
  expect(screen.queryByTestId("station-totals")).toBeNull();
}

/**
 * ST10b — the station in the list, its resolve rejected (the API's 404): the not-available card,
 * never the station body. The resolve read decides access at a station as at a site (decision 6).
 */
export async function aRejectedStationResolveShowsTheNotAvailableCard(): Promise<void> {
  stubReads(ITEMS, "reject");
  renderAt("/control-room/site/st");

  expect(await screen.findByText("Site view unavailable")).toBeInTheDocument();
  expect(screen.queryByTestId("station-totals")).toBeNull();
}

/** ST11 — a site's page links its station crumb; with `parentId: null` there is no such crumb. */
export async function aSitesStationCrumbIsALink(): Promise<void> {
  stubReads(ITEMS, view("st-1"));
  renderAt("/control-room/site/st-1");

  await stationHeading("Lotapata I");
  expect(within(crumbs()).getByRole("link", { name: "Lotapata" }).getAttribute("href")).toBe("/control-room/site/st");
  expectNoNetworkSoFar();
  cleanup();
  vi.restoreAllMocks();

  stubReads(
    ITEMS.map((item) => (item.id === "st-1" ? withFields(item, { parentId: null }) : item)),
    view("st-1"),
  );
  renderAt("/control-room/site/st-1");
  await stationHeading("Lotapata I");
  expect(within(crumbs()).queryByText("Lotapata")).toBeNull();
}

/** ST12 — owner ruling Q2 (a): the station keeps the site page's 60 s list poll. */
export async function theStationPollsTheListAtSixtySeconds(): Promise<void> {
  stubReads(ITEMS, view("st"));
  const queryClient = renderAt("/control-room/site/st");

  expect(await screen.findByTestId("station-totals")).toBeInTheDocument();
  const observers = queryClient.getQueryCache().find({ queryKey: ["dashboard", "locations"] })?.observers;
  expect(observers?.map((observer) => observer.options.refetchInterval)).toEqual([60_000]);
}

function ribbon(): string {
  return screen.getByText(/^Control Room · (site|station) view$/).textContent ?? "";
}

/**
 * ST13 (PR 1 review nit) — at a station the ribbon reads "station view", and so does the pending
 * line while the resolve read is out; a site keeps "site view" (the control).
 */
export async function theStationSaysStationView(): Promise<void> {
  stubReads(ITEMS, view("st"));
  vi.spyOn(controlRoomApi, "fetchResolvedSiteControlRoomView").mockImplementation(() => new Promise(() => undefined));
  renderAt("/control-room/site/st");
  expect(await screen.findByText("Loading the station view…")).toBeInTheDocument();
  expect(ribbon()).toBe("Control Room · station view");
  expectNoNetworkSoFar();
  cleanup();
  vi.restoreAllMocks();

  stubReads(ITEMS, view("st-1"));
  vi.spyOn(controlRoomApi, "fetchResolvedSiteControlRoomView").mockImplementation(() => new Promise(() => undefined));
  renderAt("/control-room/site/st-1");
  expect(await screen.findByText("Loading the site view…")).toBeInTheDocument();
  expect(ribbon()).toBe("Control Room · site view");
}

function pageWidth(heading: HTMLElement): string | undefined {
  return heading.closest("div.mx-auto")?.className.split(/\s+/).find((name) => name.startsWith("max-w-"));
}

/** ST14 (plan D12) — the Station view widens to 1800 px; the station's `/assets` and a site keep 1200 px. */
export async function theStationViewIsWider(): Promise<void> {
  const cases: [string, string, string][] = [
    ["/control-room/site/st", "Lotapata", "max-w-[1800px]"],
    ["/control-room/site/st/assets", "Lotapata", "max-w-[1200px]"],
    ["/control-room/site/st-1", "Lotapata I", "max-w-[1200px]"],
  ];
  for (const [path, name, width] of cases) {
    stubReads(ITEMS, view(path.split("/")[3] ?? ""));
    renderAt(path);
    expect(pageWidth(await stationHeading(name)), path).toBe(width);
    expectNoNetworkSoFar();
    cleanup();
    vi.restoreAllMocks();
  }
}

export function cleanupStation(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ scope: null });
  expect(networkCalls, "a read reached the network").toEqual([]);
}
