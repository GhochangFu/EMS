import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import type {
  AlarmSeverityDto,
  DashboardDto,
  DashboardTabDto,
  ResolvedSiteControlRoomViewDto,
  SiteWidgetsResponse,
} from "@bms/shared";

import * as siteWidgetsApi from "../../api/dashboard-site-widgets";
import * as dashboardsApi from "../../api/dashboards";
import * as vocabulariesApi from "../../api/vocabularies";
import { ApiError } from "../../lib/api-error";
import { SiteDashboardView } from "./site-dashboard-view";

/**
 * `F3.69` U2 — `SiteDashboardView`, the site page's inline dashboard (plan
 * decision D3, owner rulings OQ1 (a) and OQ2 (a)), rows S1–S8 of the plan's
 * U2 table.
 *
 * Assertions live here; `site-dashboard-view.test.tsx` is the Vitest entry
 * point and carries the `@vitest-environment jsdom` docblock (ADR 0014,
 * ADR 0042 decision 2).
 *
 * `DashboardLiveCanvas` is mocked by module: it owns the socket and the widget
 * reads (`F3.69` U1 proves those), so this suite asserts only which DTO the
 * view hands it and when. `fetch` itself is a spy and `cleanupView` fails the
 * case if anything reached it — a throwing `fetch` alone proves nothing,
 * because react-query turns the throw into `isError`.
 */
vi.mock("../dashboards/dashboard-live-canvas", () => ({
  DashboardLiveCanvas: ({ dashboard, tabKey }: { dashboard: DashboardDto; tabKey?: string }) => (
    <div data-testid="dashboard-live-canvas" data-dashboard-id={dashboard.id} data-tab-key={tabKey ?? "(all)"} />
  ),
}));

const ORG_PHE = { id: "org-phewb", code: "PHEWB", name: "PHE West Bengal" };
const SLUG = "phe-lotapata";
const LOCATION_ID = "p1";

/** The site page's resolve key (`site-page.tsx`), seeded so S7b can see it invalidated. */
const RESOLVE_KEY = ["control-room", "site-view", LOCATION_ID] as const;

const DTO: DashboardDto = {
  id: "dash-1",
  organizationId: ORG_PHE.id,
  slug: SLUG,
  name: "Lotapata Overview",
  description: null,
  locationId: LOCATION_ID,
  assetGroupId: null,
  assetId: null,
  assetTemplateId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  templateId: null,
  tabs: [],
  widgets: [],
};

const RESOLVED: ResolvedSiteControlRoomViewDto = {
  locationId: LOCATION_ID,
  kind: "dashboard",
  dashboardId: DTO.id,
  dashboardSlug: SLUG,
  builtinKey: null,
  notice: null,
};

const SEVERITIES: AlarmSeverityDto[] = [{ code: "warning", label: "Warning", tone: "warning", rank: 20, active: true }];

function notFound(): ApiError {
  return new ApiError('{"message":"Dashboard not found","statusCode":404}', 404);
}

let fetchSpy: Mock | null = null;

type Answer = DashboardDto | "reject" | "pending";

/**
 * `F3.77` — the tab markers' two reads (`useTabMarkers`). A tabbed dashboard starts them, so every
 * case stubs both: the site-widgets read stays pending unless a case answers it, which keeps the
 * strip as it was (no marker), and the vocabulary names `warning`.
 */
function stubMarkerReads(answer?: SiteWidgetsResponse): Mock {
  vi.spyOn(vocabulariesApi, "fetchVocabularies").mockResolvedValue({ alarmSeverities: SEVERITIES } as never);
  const read = vi.spyOn(siteWidgetsApi, "fetchSiteWidgets");
  if (answer === undefined) {
    read.mockImplementation(() => new Promise(() => undefined));
  } else {
    read.mockResolvedValue(answer);
  }
  return read as unknown as Mock;
}

function stubRead(...answers: Answer[]): Mock {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  stubMarkerReads();
  const read = vi.spyOn(dashboardsApi, "fetchDashboard");
  for (const answer of answers) {
    if (answer === "reject") {
      read.mockRejectedValueOnce(notFound());
    } else if (answer === "pending") {
      read.mockImplementationOnce(() => new Promise(() => undefined));
    } else {
      read.mockResolvedValueOnce(answer);
    }
  }
  return read as unknown as Mock;
}

function renderView(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
): QueryClient {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SiteDashboardView slug={SLUG} organizationId={ORG_PHE.id} locationId={LOCATION_ID} tab={undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

/** S1 — the read is addressed by the slug and the site's organization id. */
export async function readCarriesTheSiteOrganization(): Promise<void> {
  const read = stubRead(DTO);
  renderView();

  await waitFor(() => expect(read).toHaveBeenCalledWith(SLUG, ORG_PHE.id));
}

/** S2 — the section title is the dashboard's name from the DTO. */
export async function titleIsTheDashboardName(): Promise<void> {
  stubRead(DTO);
  renderView();

  expect(await screen.findByRole("heading", { name: "Lotapata Overview" })).toBeInTheDocument();
}

/** S3 — `Open in Dashboards` targets the viewer with the organization id. */
export async function linkOpensTheViewer(): Promise<void> {
  stubRead(DTO);
  renderView();

  const link = await screen.findByRole("link", { name: "Open in Dashboards" });
  expect(link.getAttribute("href")).toBe(`/dashboards/${SLUG}?organizationId=${ORG_PHE.id}`);
}

/** S4a — a pending read shows the loading line. */
export async function pendingReadSaysLoading(): Promise<void> {
  const read = stubRead("pending");
  renderView();

  await waitFor(() => expect(read).toHaveBeenCalled());
  expect(screen.getByRole("status").textContent).toMatch(/Loading dashboard/);
}

/** S4b — a pending read renders no canvas (after S4a's loading line). */
export async function pendingReadRendersNoCanvas(): Promise<void> {
  const read = stubRead("pending");
  renderView();

  await waitFor(() => expect(read).toHaveBeenCalled());
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.queryByTestId("dashboard-live-canvas")).toBeNull();
}

/** S5 — a resolved read hands its DTO to the canvas. */
export async function resolvedReadRendersTheCanvas(): Promise<void> {
  stubRead(DTO);
  renderView();

  const canvas = await screen.findByTestId("dashboard-live-canvas");
  expect(canvas.getAttribute("data-dashboard-id")).toBe("dash-1");
}

/** S6a — a rejected read shows the API's message inside an alert. */
export async function rejectedReadShowsTheApiMessage(): Promise<void> {
  stubRead("reject");
  renderView();

  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText("Dashboard not found")).toBeInTheDocument();
}

/** S6b — a rejected read renders no canvas (after S6a's alert). */
export async function rejectedReadRendersNoCanvas(): Promise<void> {
  stubRead("reject");
  renderView();

  await screen.findByRole("alert");
  expect(screen.queryByTestId("dashboard-live-canvas")).toBeNull();
}

/** S7a — `Try again` re-reads the dashboard and renders the second answer. */
export async function tryAgainRereadsTheDashboard(): Promise<void> {
  const read = stubRead("reject", DTO);
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

  const canvas = await screen.findByTestId("dashboard-live-canvas");
  expect([read.mock.calls.length, canvas.getAttribute("data-dashboard-id")]).toEqual([2, "dash-1"]);
}

/**
 * S7b — `Try again` also invalidates the site page's resolve read, so a
 * dashboard deleted between the two reads flips the page to the generated
 * view and the API's `dashboard_removed` notice. The seeded entry is not
 * invalidated before the click (the positive control).
 */
export async function tryAgainInvalidatesTheResolveRead(): Promise<void> {
  stubRead("reject", "pending");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData([...RESOLVE_KEY], RESOLVED);
  renderView(queryClient);

  const button = await screen.findByRole("button", { name: "Try again" });
  expect(queryClient.getQueryState([...RESOLVE_KEY])?.isInvalidated).toBe(false);
  fireEvent.click(button);

  await waitFor(() => expect(queryClient.getQueryState([...RESOLVE_KEY])?.isInvalidated).toBe(true));
}

/** Two unrelated cache entries S7c seeds alongside the resolve read, to prove the
 * invalidation is scoped to that read's own prefix and nothing wider. */
const GENERATED_SITE_VIEW_KEY = ["control-room", "generated-site-view", LOCATION_ID] as const;
const DASHBOARD_LOCATIONS_KEY = ["dashboard", "locations"] as const;

/**
 * S7c — `Try again` invalidates ONLY the resolve read, not every
 * `["control-room", ...]` entry and not an unrelated `["dashboard", ...]`
 * one. S7b (above) is the positive control: without it, an
 * `invalidateQueries()` with no key, or one scoped to the bare `["control-room"]`
 * prefix, would ALSO satisfy S7b's own assertion — this is the negative half
 * that catches both.
 */
export async function tryAgainInvalidatesOnlyTheResolveRead(): Promise<void> {
  stubRead("reject", "pending");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData([...RESOLVE_KEY], RESOLVED);
  queryClient.setQueryData([...GENERATED_SITE_VIEW_KEY], { headline: [] });
  queryClient.setQueryData([...DASHBOARD_LOCATIONS_KEY], []);
  renderView(queryClient);

  const button = await screen.findByRole("button", { name: "Try again" });
  fireEvent.click(button);

  await waitFor(() => expect(queryClient.getQueryState([...RESOLVE_KEY])?.isInvalidated).toBe(true));
  expect(queryClient.getQueryState([...GENERATED_SITE_VIEW_KEY])?.isInvalidated).toBe(false);
  expect(queryClient.getQueryState([...DASHBOARD_LOCATIONS_KEY])?.isInvalidated).toBe(false);
}

const DASHBOARD_KEY = ["dashboards", "detail", SLUG, ORG_PHE.id] as const;

/**
 * A good first answer, then a background refetch that rejects — a window
 * refocus during an API restart. Returns once the rejected call has been made
 * and the refetch has settled, so an assertion after it cannot pass before
 * the failure landed.
 */
async function renderThenFailARefetch(): Promise<void> {
  const read = stubRead(DTO, "reject");
  const queryClient = renderView();

  await screen.findByTestId("dashboard-live-canvas");
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: [...DASHBOARD_KEY] });
  });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(queryClient.getQueryState([...DASHBOARD_KEY])?.status).toBe("error"));
}

/** S9a — a failed background refetch keeps the canvas the first answer produced (data-first). */
export async function aFailedRefetchKeepsTheCanvas(): Promise<void> {
  await renderThenFailARefetch();

  expect(screen.getByTestId("dashboard-live-canvas").getAttribute("data-dashboard-id")).toBe("dash-1");
}

/** S9b — a failed background refetch shows no alert (after S9a's canvas). */
export async function aFailedRefetchShowsNoAlert(): Promise<void> {
  await renderThenFailARefetch();

  expect(screen.getByTestId("dashboard-live-canvas")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
}

/** S8 — no Edit link on the site view (OQ1 (a)); `Open in Dashboards` is the positive control. */
export async function noEditLink(): Promise<void> {
  stubRead(DTO);
  renderView();

  await screen.findByRole("link", { name: "Open in Dashboards" });
  await screen.findByTestId("dashboard-live-canvas");
  expect(screen.queryByRole("link", { name: /Edit dashboard/ })).toBeNull();
}

/**
 * `F3.73` plan D10 — a two-tab dashboard. The array holds `sld` FIRST and `overview` second
 * while `overview` sorts first, so a strip or a default that read the array order goes red.
 */
function tab(key: string, label: string, sortOrder: number): DashboardTabDto {
  return {
    id: `tab-${key}`,
    dashboardId: DTO.id,
    organizationId: ORG_PHE.id,
    key,
    label,
    sortOrder,
    assetGroupId: null,
  };
}

const TABBED: DashboardDto = { ...DTO, tabs: [tab("sld", "SLD", 1), tab("overview", "Overview", 0)] };

const SITE_PATH = `/control-room/site/${LOCATION_ID}`;

/** The router's pathname, rendered outside `<Routes>`, so a redirect to the bare path is visible. */
function PathnameProbe() {
  const { pathname, search } = useLocation();
  return (
    <>
      <p data-testid="pathname">{pathname}</p>
      <p data-testid="search">{search}</p>
    </>
  );
}

/** The view at the site route, with the `:tab` segment the site page would hand it. */
function TabRoute() {
  const { pathname } = useLocation();
  const segment = pathname.slice(SITE_PATH.length + 1);
  return (
    <SiteDashboardView
      slug={SLUG}
      organizationId={ORG_PHE.id}
      locationId={LOCATION_ID}
      tab={segment === "" ? undefined : segment}
    />
  );
}

function renderAtTab(segment?: string, search = ""): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`${segment === undefined ? SITE_PATH : `${SITE_PATH}/${segment}`}${search}`]}>
        <PathnameProbe />
        <Routes>
          <Route path="/control-room/site/:locationId/:tab?" element={<TabRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function pathname(): string {
  return screen.getByTestId("pathname").textContent ?? "";
}

/** The view as the wall frame renders it (`site-page.tsx`'s `WallFrame` branch), on a tabbed dashboard. */
function renderWall(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`${SITE_PATH}?wall=1&every=30`]}>
        <SiteDashboardView slug={SLUG} organizationId={ORG_PHE.id} locationId={LOCATION_ID} tab={undefined} wall />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * T11a (`F3.77` follow-up, plan D6) — on the wall the dashboard's name stays the level-2 heading
 * (h1 → h2 → h3 holds) but is visually hidden: the bar already names the site. S2 is the control.
 * Mutation: ignore `wall` => the `SectionCard` title has no `sr-only` => red.
 */
export async function theWallHidesTheTitle(): Promise<void> {
  stubRead(TABBED);
  renderWall();

  const heading = await screen.findByRole("heading", { level: 2, name: "Lotapata Overview" });
  expect(heading).toHaveClass("sr-only");
}

/**
 * T11b — the wall shows no `Open in Dashboards` link. The canvas is the positive control, so an
 * absent link is not an absent view. Mutation: ignore `wall` => the link shows => red.
 */
export async function theWallShowsNoOpenLink(): Promise<void> {
  stubRead(TABBED);
  renderWall();

  await screen.findByTestId("dashboard-live-canvas");
  expect(screen.queryByRole("link", { name: "Open in Dashboards" })).toBeNull();
}

/** T11c — the wall keeps the tab strip: a tab is still chosen by hand on a wall screen. */
export async function theWallKeepsTheTabStrip(): Promise<void> {
  stubRead(TABBED);
  renderWall();

  const strip = await screen.findByRole("navigation", { name: "Dashboard tabs" });
  expect(within(strip).getAllByRole("link")).toHaveLength(2);
}

/** T1 — two tabs render as links to their `:tab` paths, in `sortOrder` order. */
export async function twoTabsRenderAsLinks(): Promise<void> {
  stubRead(TABBED);
  renderAtTab("sld");

  const strip = await screen.findByRole("navigation", { name: "Dashboard tabs" });
  const links = within(strip).getAllByRole("link");
  expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Overview", `${SITE_PATH}/overview`],
    ["SLD", `${SITE_PATH}/sld`],
  ]);
}

/** T2 — the selected tab's link carries `aria-current="page"`; the other does not. */
export async function theSelectedTabIsCurrent(): Promise<void> {
  stubRead(TABBED);
  renderAtTab("sld");

  const strip = await screen.findByRole("navigation", { name: "Dashboard tabs" });
  expect(within(strip).getByRole("link", { name: "SLD" }).getAttribute("aria-current")).toBe("page");
  expect(within(strip).getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBeNull();
}

/** T3 — `/sld` hands the canvas `tabKey: "sld"`, and stays at `/sld`. */
export async function aTabSegmentSelectsThatTab(): Promise<void> {
  stubRead(TABBED);
  renderAtTab("sld");

  const canvas = await screen.findByTestId("dashboard-live-canvas");
  expect([canvas.getAttribute("data-tab-key"), pathname()]).toEqual(["sld", `${SITE_PATH}/sld`]);
}

/** T4 — the bare path selects the first tab by `sortOrder`, in place (no redirect). */
export async function theBarePathSelectsTheFirstTab(): Promise<void> {
  stubRead(TABBED);
  renderAtTab();

  const canvas = await screen.findByTestId("dashboard-live-canvas");
  expect([canvas.getAttribute("data-tab-key"), pathname()]).toEqual(["overview", SITE_PATH]);
}

/** T5 — an unknown tab key redirects to the bare path, which shows the first tab. */
export async function anUnknownTabRedirectsToTheBarePath(): Promise<void> {
  stubRead(TABBED, TABBED);
  renderAtTab("x");

  await waitFor(() => expect(pathname()).toBe(SITE_PATH));
  expect((await screen.findByTestId("dashboard-live-canvas")).getAttribute("data-tab-key")).toBe("overview");
}

/**
 * T9 (`F3.77`, wall mode) — the tab links keep the current query, so a tab chosen on a wall screen
 * stays in wall mode. Mutation: drop `search` from the link => the hrefs lose the query => red.
 */
export async function theTabLinksKeepTheQuery(): Promise<void> {
  stubRead(TABBED);
  renderAtTab("sld", "?wall=1&every=30");

  const strip = await screen.findByRole("navigation", { name: "Dashboard tabs" });
  expect(within(strip).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
    `${SITE_PATH}/overview?wall=1&every=30`,
    `${SITE_PATH}/sld?wall=1&every=30`,
  ]);
}

/**
 * T10 (`F3.77`, wall mode) — an unknown tab redirects to the bare path with the query kept.
 * Mutation: redirect to `sitePath` alone => the search probe is empty => red.
 */
export async function anUnknownTabRedirectKeepsTheQuery(): Promise<void> {
  stubRead(TABBED, TABBED);
  renderAtTab("x", "?wall=1&every=30");

  await waitFor(() => expect(pathname()).toBe(SITE_PATH));
  expect(screen.getByTestId("search").textContent).toBe("?wall=1&every=30");
}

/** T6 — a dashboard with no tabs renders as today: no strip, the whole canvas (no `tabKey`). */
export async function aDashboardWithNoTabsRendersAsToday(): Promise<void> {
  stubRead(DTO);
  renderAtTab();

  const canvas = await screen.findByTestId("dashboard-live-canvas");
  expect(canvas.getAttribute("data-tab-key")).toBe("(all)");
  expect(screen.queryByRole("navigation", { name: "Dashboard tabs" })).toBeNull();
}

/** T7 — a `:tab` segment on a dashboard with no tabs redirects to the bare path (the page no longer does). */
export async function aTabOnAnUntabbedDashboardRedirects(): Promise<void> {
  stubRead(DTO, DTO);
  renderAtTab("sld");

  await waitFor(() => expect(pathname()).toBe(SITE_PATH));
  expect(await screen.findByTestId("dashboard-live-canvas")).toBeInTheDocument();
}

/** T8 — a pending read does not redirect an unknown tab: the decision waits for the data. */
export async function aPendingReadDoesNotRedirect(): Promise<void> {
  const read = stubRead("pending");
  renderAtTab("x");

  await waitFor(() => expect(read).toHaveBeenCalled());
  expect(screen.getByRole("status").textContent).toMatch(/Loading dashboard/);
  expect(pathname()).toBe(`${SITE_PATH}/x`);
}

/**
 * `F3.77` (plan D4) — a site layout with two group tabs: HVAC readable with two warnings,
 * Environment outside the caller's scope. The Overview is no group tab, so `tabs[]` omits it.
 */
const MARKED: DashboardDto = {
  ...DTO,
  tabs: [tab("env", "Environment", 2), tab("overview", "Overview", 0), tab("hvac", "HVAC", 1)],
};

const MARKERS_ANSWER: SiteWidgetsResponse = {
  dashboardId: DTO.id,
  tabKey: "overview",
  resolvedAt: "2026-10-01T10:00:00.000Z",
  scope: { assetCount: 4 },
  alarms: { active: [], summary: [] },
  roles: [],
  breakers: [],
  stateMaps: [],
  tabs: [
    {
      tabKey: "hvac",
      label: "HVAC",
      assetGroupId: null,
      status: { worstSeverity: "warning", tone: "warning", activeAlarms: 2, offlineAssets: 0, assets: 4 },
    },
    { tabKey: "env", label: "Environment", assetGroupId: null, status: null },
  ],
};

/** Renders `MARKED` with the markers answered, and returns the strip once a marker has drawn. */
async function renderMarked(segment?: string): Promise<{ strip: HTMLElement; markersRead: Mock }> {
  stubRead(MARKED, MARKED);
  const markersRead = stubMarkerReads(MARKERS_ANSWER);
  renderAtTab(segment);
  const strip = await screen.findByRole("navigation", { name: "Dashboard tabs" });
  await within(strip).findByText("2 alarms");
  return { strip, markersRead };
}

/** M1 — the HVAC link is named by its status and shows the count. */
export async function aGroupTabLinkIsNamedByItsStatus(): Promise<void> {
  const { strip } = await renderMarked();
  const hvac = within(strip).getByRole("link", { name: "HVAC, Warning, 2 alarms" });
  expect(hvac).toHaveTextContent("2 alarms");
}

/** M2 — the Overview link has no marker: its name is its label (HVAC's marker beside it is the
 * positive control). */
export async function theOverviewLinkHasNoMarker(): Promise<void> {
  const { strip } = await renderMarked();
  const overview = within(strip).getByRole("link", { name: "Overview" });
  expect(overview).not.toHaveAttribute("aria-label");
  expect(overview.textContent).toBe("Overview");
}

/** M3 — a tab outside the caller's scope reads "Outside scope", never a zero. */
export async function aTabOutsideScopeSaysSoNeverAZero(): Promise<void> {
  const { strip } = await renderMarked();
  const env = within(strip).getByRole("link", { name: "Environment, Outside scope" });
  expect(env).toHaveTextContent("Outside scope");
  expect(env.textContent).not.toMatch(/\d/);
}

/**
 * M4 — the markers read with the first stored tab's key (the Overview's own entry), so a tab switch
 * makes no second read. The settle lets a re-keyed read start before the calls are read.
 * Mutation: key `useTabMarkers` on the selected tab => a call with "hvac" => red.
 */
export async function aTabSwitchMakesNoSecondMarkersRead(): Promise<void> {
  const { strip, markersRead } = await renderMarked();
  fireEvent.click(within(strip).getByRole("link", { name: "HVAC, Warning, 2 alarms" }));
  await waitFor(() => expect(screen.getByTestId("dashboard-live-canvas").getAttribute("data-tab-key")).toBe("hvac"));
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(markersRead.mock.calls.map((call) => call[1])).toEqual(["overview"]);
}

/** M5 — before the markers read answers, no tab draws a marker: never a zero while loading. */
export async function aPendingMarkersReadDrawsNoMarker(): Promise<void> {
  stubRead(MARKED);
  renderAtTab();
  const strip = await screen.findByRole("navigation", { name: "Dashboard tabs" });
  expect(within(strip).getByRole("link", { name: "HVAC" }).textContent).toBe("HVAC");
  expect(strip.textContent).not.toMatch(/alarm|Outside scope/);
}

/** Unmounts, restores the spies and fails the case if any read reached the network. */
export function cleanupView(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(networkCalls, "a read reached the network").toEqual([]);
}
