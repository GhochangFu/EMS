import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import type {
  AccessibleScope,
  LocationKpiSummary,
  ResolvedSiteControlRoomViewDto,
  SiteControlRoomViewNotice,
} from "@bms/shared";

import * as assetsApi from "../../api/assets";
import * as controlRoomApi from "../../api/control-room";
import * as locationsApi from "../../api/locations";
import * as systemStatusApi from "../../api/system-status";
import { OPERATIONAL } from "../../components/system-status-indicator.spec";
import { siteViewNoticeText } from "../../lib/site-view-notice";
import { useAuthStore } from "../../stores/auth-store";
import { ORG_A, ORG_B, site, USER } from "./organizations-page.spec";
import { ControlRoomSitePage } from "./site-page";

/**
 * `F3.68` U7 — the site page hosts `GeneratedSiteView` for the `generated`
 * kind (D7 wired). The component owns its own reads and its own KPI tiles,
 * so this suite mocks it: it asserts the page passes the right `locationId`
 * and hosts it beside the notice banner, not what the component renders.
 * `F3.70` U4: the mock records the pathname it mounted at (V18b).
 */
const mounts = vi.hoisted(() => ({ generated: [] as string[] }));

vi.mock("../../components/control-room/generated-site-view", () => ({
  GeneratedSiteView: ({ locationId }: { locationId: string }) => {
    const { pathname } = useLocation();
    useEffect(() => {
      mounts.generated.push(pathname);
    }, []);
    return <div data-testid="generated-site-view" data-location-id={locationId} />;
  },
}));

/**
 * `F3.70` U4 — the `builtin` branch hosts `SmocSiteView`, which owns the tab
 * strip, the per-area rule and the seven contents (its own suite, T1–T7).
 * This suite asserts the page passes the right `locationId`, `tab` and
 * `scope`, not what the view renders.
 */
vi.mock("../../components/control-room/smoc-site-view", () => ({
  SmocSiteView: ({
    locationId,
    tab,
    scope,
  }: {
    locationId: string;
    tab: string;
    scope: AccessibleScope | null;
  }) => (
    <div
      data-testid="smoc-site-view"
      data-tab={tab}
      data-location-id={locationId}
      data-scope-kind={scope?.kind ?? "none"}
    />
  ),
}));

/**
 * `F3.69` U3 — `SiteDashboardView` hosts the `dashboard` kind (plan decision
 * D4). The component owns its own read, its own states and the `Open in
 * Dashboards` link (`F3.69` U2 proves those); this suite asserts only which
 * slug and organization id the page hands it.
 */
vi.mock("../../components/control-room/site-dashboard-view", () => ({
  SiteDashboardView: ({ slug, organizationId }: { slug: string; organizationId: string }) => (
    <div data-testid="site-dashboard-view" data-slug={slug} data-organization-id={organizationId} />
  ),
}));

/**
 * `F3.66` U4 — `/control-room/site/:locationId`, the site view host (ADR 0076
 * decisions 2 and 5), rows V1a–V16 of the plan's U4 table; `F3.70` U4
 * rewrote V5/V6 for the `:tab?` param and added V17–V20 (OQ5, D5).
 *
 * Assertions live here; `site-page.test.tsx` is the Vitest entry point and
 * carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042
 * decision 2).
 *
 * The page renders inside `AppShell`, so every case stubs what the shell reads
 * on mount (`fetchSystemStatus`, `F4.160`; `fetchAssets`, which the shell
 * called until `F3.66` U6 and is stubbed still), plus the page's two reads. `fetch` itself
 * is a spy, and `cleanupPage` fails the case if anything reached it: a
 * throwing `fetch` alone proves nothing, because react-query turns the throw
 * into `isError`.
 *
 * Every link query is scoped to its own container — the shell's sidebar holds
 * links of its own (a `/control-room` entry since `F3.66` U6).
 */

const GLOBAL: AccessibleScope = { kind: "global", locations: [], assetGroups: [], assetIds: [] };

const HVAC_ONLY: AccessibleScope = {
  kind: "asset_group",
  locations: [],
  assetGroups: [
    {
      id: "66666666-6666-4666-8666-666666666666",
      locationId: "22222222-2222-4222-8222-222222222222",
      code: "hvac",
      name: "HVAC",
      organizationId: "77777777-7777-4777-8777-777777777777",
    },
  ],
  assetIds: [],
};

const ORG_PHE = { id: "org-phewb", code: "PHEWB", name: "PHE West Bengal" };

/** Two organizations; A holds two sites, so every level shows in the crumbs. */
const TWO_ORGS: LocationKpiSummary[] = [
  site({ id: "a1", name: "Alpha One", organization: ORG_A }),
  site({ id: "a2", name: "Alpha Two", organization: ORG_A }),
  site({ id: "b1", name: "Beta One", organization: ORG_B }),
];

const PHE_SITES: LocationKpiSummary[] = [
  site({ id: "p1", name: "Lotapata", organization: ORG_PHE }),
  site({ id: "p2", name: "Other Plant", organization: ORG_PHE }),
];

function view(
  locationId: string,
  fields: Partial<ResolvedSiteControlRoomViewDto> = {},
): ResolvedSiteControlRoomViewDto {
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

function generatedWith(notice: SiteControlRoomViewNotice): ResolvedSiteControlRoomViewDto {
  return view("a1", { notice });
}

type ViewAnswer = ResolvedSiteControlRoomViewDto | "reject";

let fetchSpy: Mock | null = null;

function stubReads(
  items: LocationKpiSummary[],
  answer: ViewAnswer,
  scope: AccessibleScope = GLOBAL,
): void {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  useAuthStore.setState({ scope });
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([]);
  vi.spyOn(locationsApi, "fetchLocationKpis").mockResolvedValue({ items });
  const resolve = vi.spyOn(controlRoomApi, "fetchResolvedSiteControlRoomView");
  if (answer === "reject") {
    resolve.mockRejectedValue(new Error("control-room/site-view 404"));
  } else {
    resolve.mockResolvedValue(answer);
  }
}

/** Any path the site route does not match. */
function Landed() {
  const { pathname } = useLocation();
  return <p>landed on {pathname}</p>;
}

/**
 * The router's pathname, rendered outside `<Routes>`: the bare site path
 * matches the site route itself, so only this probe observes a D5 redirect.
 */
function PathnameProbe() {
  const { pathname } = useLocation();
  return <p data-testid="pathname">{pathname}</p>;
}

function renderAt(
  locationId: string,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  tab?: string,
): void {
  const path = `/control-room/site/${locationId}${tab === undefined ? "" : `/${tab}`}`;
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <PathnameProbe />
        <Routes>
          <Route path="/control-room/site/:locationId/:tab?" element={<ControlRoomSitePage user={USER} />} />
          <Route path="*" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function pathname(): string {
  return screen.getByTestId("pathname").textContent ?? "";
}

function sectionOf(element: HTMLElement): HTMLElement {
  const section = element.closest("section");
  expect(section, "the text is not inside a SectionCard").not.toBeNull();
  return section as HTMLElement;
}

/** V1a — `generated`: hosts `GeneratedSiteView` with the page's `locationId` (D7 wired). */
export async function generatedRendersTheComponentWithLocationId(): Promise<void> {
  stubReads(TWO_ORGS, view("a1"));
  renderAt("a1");

  const mount = await screen.findByTestId("generated-site-view");
  expect(mount.getAttribute("data-location-id")).toBe("a1");
}

/** V1b — no notice, no banner (after V1a's positive control). */
export async function noNoticeRendersNoBanner(): Promise<void> {
  stubReads(TWO_ORGS, view("a1"));
  renderAt("a1");

  expect(await screen.findByTestId("generated-site-view")).toBeInTheDocument();
  expect(screen.queryByTestId("site-view-notice")).toBeNull();
}

/** V2 — `dashboard_removed`: the banner carries its text, and the component still renders. */
export async function dashboardRemovedShowsItsBanner(): Promise<void> {
  stubReads(TWO_ORGS, generatedWith("dashboard_removed"));
  renderAt("a1");

  const banner = await screen.findByTestId("site-view-notice");
  expect(banner.getAttribute("role")).toBe("status");
  expect(banner.textContent).toBe(siteViewNoticeText("dashboard_removed"));
  expect(screen.getByTestId("generated-site-view")).toBeInTheDocument();
}

/** V3 — `dashboard_out_of_scope`: its own text, not V2's. */
export async function dashboardOutOfScopeShowsItsBanner(): Promise<void> {
  stubReads(TWO_ORGS, generatedWith("dashboard_out_of_scope"));
  renderAt("a1");

  const banner = await screen.findByTestId("site-view-notice");
  expect(banner.textContent).toBe(siteViewNoticeText("dashboard_out_of_scope"));
  expect(banner.textContent).not.toContain(siteViewNoticeText("dashboard_removed"));
}

/** V4 — `builtin_unknown`: its own text. */
export async function builtinUnknownShowsItsBanner(): Promise<void> {
  stubReads(TWO_ORGS, generatedWith("builtin_unknown"));
  renderAt("a1");

  const banner = await screen.findByTestId("site-view-notice");
  expect(banner.textContent).toBe(siteViewNoticeText("builtin_unknown"));
}

/**
 * The SMOC site is `RSMOC-WC` in `ESKOM` (`isSmocSite`). The fixture spells
 * both codes as literals so a mutated constant cannot carry the fixture along.
 */
const ORG_ESKOM = { id: "org-eskom", code: "ESKOM", name: "Eskom" };

const SMOC_SITES: LocationKpiSummary[] = [
  ...TWO_ORGS,
  site({ id: "s1", name: "SMOC Campus", code: "RSMOC-WC", organization: ORG_ESKOM }),
];

const SMOC_VIEW = view("s1", { kind: "builtin", builtinKey: "smoc" });

/**
 * `F3.70` security review L1 — a site with the same code in another
 * organization: a `builtin/smoc` resolve there must not mount the SMOC tabs.
 */
const PHE_RSMOC_SITES: LocationKpiSummary[] = [
  site({ id: "p9", name: "PHE Namesake", code: "RSMOC-WC", organization: ORG_PHE }),
];

const PHE_BUILTIN_VIEW = view("p9", { kind: "builtin", builtinKey: "smoc" });

/** V5 — `builtin/smoc` at the bare path: `SmocSiteView` for this site, on the overview tab (OQ1, OQ2). */
export async function builtinHostsSmocSiteViewOnTheOverview(): Promise<void> {
  stubReads(SMOC_SITES, SMOC_VIEW);
  renderAt("s1");

  const mount = await screen.findByTestId("smoc-site-view");
  expect([mount.getAttribute("data-location-id"), mount.getAttribute("data-tab")]).toEqual([
    "s1",
    "overview",
  ]);
}

/** V6a — `builtin/smoc` with a tab segment: `SmocSiteView` gets that tab (D2). */
export async function builtinPassesTheTabParam(): Promise<void> {
  stubReads(SMOC_SITES, SMOC_VIEW);
  renderAt("s1", undefined, "hvac");

  const mount = await screen.findByTestId("smoc-site-view");
  expect(mount.getAttribute("data-tab")).toBe("hvac");
}

/** V6b — `SmocSiteView` gets the caller's scope, so its per-area rule reads it (D3). */
export async function builtinPassesTheScope(): Promise<void> {
  stubReads(SMOC_SITES, SMOC_VIEW, HVAC_ONLY);
  renderAt("s1");

  const mount = await screen.findByTestId("smoc-site-view");
  expect(mount.getAttribute("data-scope-kind")).toBe("asset_group");
}

/** V7 — `dashboard`: hosts `SiteDashboardView` with the slug and the site's organization id (D4). */
export async function dashboardRendersSiteDashboardView(): Promise<void> {
  stubReads(
    PHE_SITES,
    view("p1", {
      kind: "dashboard",
      dashboardId: "d1",
      dashboardSlug: "phe-lotapata",
    }),
  );
  renderAt("p1");

  const mount = await screen.findByTestId("site-dashboard-view");
  expect(mount.getAttribute("data-slug")).toBe("phe-lotapata");
  expect(mount.getAttribute("data-organization-id")).toBe(ORG_PHE.id);
}

/** V7b — after V7: no interim text, and no real `/dashboards/` link outside the mock. */
export async function dashboardShowsNoInterimCard(): Promise<void> {
  stubReads(
    PHE_SITES,
    view("p1", {
      kind: "dashboard",
      dashboardId: "d1",
      dashboardSlug: "phe-lotapata",
    }),
  );
  renderAt("p1");

  await screen.findByTestId("site-dashboard-view");
  expect(screen.queryByText(/This site shows the dashboard/)).toBeNull();
  expect(document.querySelectorAll('a[href^="/dashboards/"]')).toHaveLength(0);
}

/** V7c — a `dashboard` view renders no notice banner (positive control: V7's testid present). */
export async function dashboardShowsNoNoticeBanner(): Promise<void> {
  stubReads(
    PHE_SITES,
    view("p1", {
      kind: "dashboard",
      dashboardId: "d1",
      dashboardSlug: "phe-lotapata",
    }),
  );
  renderAt("p1");

  expect(await screen.findByTestId("site-dashboard-view")).toBeInTheDocument();
  expect(screen.queryByTestId("site-view-notice")).toBeNull();
}

/** V8a — a rejected resolve read: the not-available card, linking to `/control-room` (D6). */
export async function aRejectedReadShowsTheNotAvailableCard(): Promise<void> {
  stubReads(TWO_ORGS, "reject");
  renderAt("a1");

  const card = sectionOf(await screen.findByText(/not available in your access scope/));
  expect(within(card).getByRole("link").getAttribute("href")).toBe("/control-room");
}

/** V8b — a rejected resolve read renders no interim body (after V8a's positive control). */
export async function aRejectedReadShowsNoInterimBody(): Promise<void> {
  stubReads(TWO_ORGS, "reject");
  renderAt("a1");

  expect(await screen.findByText(/not available in your access scope/)).toBeInTheDocument();
  expect(screen.queryByTestId("generated-site-view")).toBeNull();
}

/** V9 — the crumbs: `Control Room` and the organization as links, the site as text. */
export async function theBreadcrumbNamesEveryLevel(): Promise<void> {
  stubReads(TWO_ORGS, view("a1"));
  renderAt("a1");

  const nav = await screen.findByRole("navigation", { name: "Breadcrumb" });
  expect(within(nav).getByRole("link", { name: "Control Room" }).getAttribute("href")).toBe(
    "/control-room",
  );
  expect(within(nav).getByRole("link", { name: ORG_A.name }).getAttribute("href")).toBe(
    `/control-room/org/${ORG_A.id}`,
  );
  const current = within(nav).getByText("Alpha One");
  expect(current.closest("a"), "the current crumb must not be a link").toBeNull();
}

/** V10 — the header names the site from the KPI list, not the route param. */
export async function theHeaderNamesTheSite(): Promise<void> {
  stubReads(TWO_ORGS, view("a1"));
  renderAt("a1");

  expect(await screen.findByRole("heading", { name: "Alpha One" })).toBeInTheDocument();
}

/** V11 — a site outside the KPI list shows the D6 card, even when the resolve read answers. */
export async function aSiteOutsideTheListShowsTheNotAvailableCard(): Promise<void> {
  stubReads(TWO_ORGS, view("zz"));
  renderAt("zz");

  const card = sectionOf(await screen.findByText(/not available in your access scope/));
  expect(within(card).getByRole("link").getAttribute("href")).toBe("/control-room");
}

function stubRejectedKpiRead(): void {
  stubReads(TWO_ORGS, view("a1"));
  vi.spyOn(locationsApi, "fetchLocationKpis").mockRejectedValue(new Error("dashboard 500"));
}

/** V12a — a rejected KPI read shows the "Control Room unavailable" card. */
export async function aRejectedKpiReadShowsTheUnavailableCard(): Promise<void> {
  stubRejectedKpiRead();
  renderAt("a1");

  expect(await screen.findByText("Control Room unavailable")).toBeInTheDocument();
}

/** V12b — a rejected KPI read renders no interim body (after V12a's positive control). */
export async function aRejectedKpiReadShowsNoInterimBody(): Promise<void> {
  stubRejectedKpiRead();
  renderAt("a1");

  expect(await screen.findByText("Control Room unavailable")).toBeInTheDocument();
  expect(screen.queryByTestId("generated-site-view")).toBeNull();
}

const DASHBOARD_WITHOUT_SLUG = view("a1", { kind: "dashboard", dashboardId: "d1", dashboardSlug: null });

/** V13a — `dashboard` with a null slug falls back to the generated interim (now the component). */
export async function aNullSlugShowsTheGeneratedInterim(): Promise<void> {
  stubReads(TWO_ORGS, DASHBOARD_WITHOUT_SLUG);
  renderAt("a1");

  expect(await screen.findByTestId("generated-site-view")).toBeInTheDocument();
}

/**
 * V13b — `dashboard` with a null slug mounts no dashboard view and links to
 * no dashboard. It waits on the generated body (V13a is its positive control),
 * so it does not pass before the body exists. The mocked `SiteDashboardView`
 * renders no link, so the mount check is what reddens when the null-slug
 * guard is dropped. The prefix keeps the trailing slash: the sidebar links
 * `/dashboards`.
 */
export async function aNullSlugLinksToNoDashboard(): Promise<void> {
  stubReads(TWO_ORGS, DASHBOARD_WITHOUT_SLUG);
  renderAt("a1");

  await screen.findByTestId("generated-site-view");
  expect(screen.queryByTestId("site-dashboard-view")).toBeNull();
  expect(document.querySelectorAll('a[href^="/dashboards/"]')).toHaveLength(0);
}

/**
 * V14 — the resolve query does not retry: a 404 is an answer, not a transient
 * failure. This client retries twice with no delay, so a query that inherits
 * the default calls the resolve client three times before the card shows.
 */
export async function aRejectedResolveReadIsNotRetried(): Promise<void> {
  stubReads(TWO_ORGS, "reject");
  renderAt("a1", new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 0 } } }));

  expect(await screen.findByText(/not available in your access scope/)).toBeInTheDocument();
  expect(controlRoomApi.fetchResolvedSiteControlRoomView).toHaveBeenCalledTimes(1);
}

const SITE_VIEW_KEY = ["control-room", "site-view", "a1"] as const;

/**
 * Renders a1 with a resolve read that answered, then makes the next resolve
 * call reject and refetches — a window refocus during an API restart. Returns
 * once the query is in the error state with the second call made, so an
 * absence assertion after it cannot pass before the refetch has failed.
 */
async function renderThenFailARefetch(): Promise<void> {
  stubReads(TWO_ORGS, view("a1"));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderAt("a1", queryClient);

  expect(await screen.findByTestId("generated-site-view")).toBeInTheDocument();
  const resolve = vi.mocked(controlRoomApi.fetchResolvedSiteControlRoomView);
  resolve.mockRejectedValue(new Error("control-room/site-view 503"));
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: [...SITE_VIEW_KEY] });
  });
  await waitFor(() => {
    expect(queryClient.getQueryState([...SITE_VIEW_KEY])?.status).toBe("error");
    expect(resolve).toHaveBeenCalledTimes(2);
  });
}

/** V15a — a failed background refetch keeps the body the first read produced. */
export async function aFailedRefetchKeepsTheBody(): Promise<void> {
  await renderThenFailARefetch();

  expect(screen.getByTestId("generated-site-view")).toBeInTheDocument();
}

/** V15b — a failed background refetch shows no not-available card (after V15a's positive control). */
export async function aFailedRefetchShowsNoNotAvailableCard(): Promise<void> {
  await renderThenFailARefetch();

  expect(screen.getByTestId("generated-site-view")).toBeInTheDocument();
  expect(screen.queryByText(/not available in your access scope/)).toBeNull();
}

/**
 * V16 — D1: while the KPI read is pending the page decides nothing — the
 * loading line shows and the not-available card does not.
 */
export async function aPendingKpiReadShowsOnlyTheLoadingLine(): Promise<void> {
  stubReads(TWO_ORGS, view("a1"));
  const kpis = vi
    .spyOn(locationsApi, "fetchLocationKpis")
    .mockImplementation(() => new Promise(() => undefined));
  renderAt("a1");

  await waitFor(() => expect(kpis).toHaveBeenCalled());
  expect(screen.getByText("Loading Control Room…")).toBeInTheDocument();
  expect(screen.queryByText(/not available in your access scope/)).toBeNull();
}

/** V17 — an unknown tab on a `builtin` site redirects to the bare site path (OQ5, D5). */
export async function anUnknownTabRedirectsToTheBarePath(): Promise<void> {
  stubReads(SMOC_SITES, SMOC_VIEW);
  renderAt("s1", undefined, "bogus");

  expect(await screen.findByTestId("smoc-site-view")).toBeInTheDocument();
  expect(pathname()).toBe("/control-room/site/s1");
}

/** V18a — a tab segment on a `generated` site redirects to the bare site path (OQ5, D5). */
export async function aTabOnAGeneratedSiteRedirectsToTheBarePath(): Promise<void> {
  stubReads(TWO_ORGS, view("a1"));
  renderAt("a1", undefined, "sld");

  expect(await screen.findByTestId("generated-site-view")).toBeInTheDocument();
  expect(pathname()).toBe("/control-room/site/a1");
}

/**
 * V18b — the redirect is decided in the page, before the body (D5): the
 * generated body never mounts at the tab URL, only at the bare path.
 */
export async function aTabOnAGeneratedSiteMountsNoBodyAtTheTabUrl(): Promise<void> {
  stubReads(TWO_ORGS, view("a1"));
  renderAt("a1", undefined, "sld");

  expect(await screen.findByTestId("generated-site-view")).toBeInTheDocument();
  expect(mounts.generated).toEqual(["/control-room/site/a1"]);
}

/** V19a — a rejected resolve read with a tab segment shows the not-available card (D6). */
export async function aRejectedReadWithATabShowsTheNotAvailableCard(): Promise<void> {
  stubReads(TWO_ORGS, "reject");
  renderAt("a1", undefined, "sld");

  const card = sectionOf(await screen.findByText(/not available in your access scope/));
  expect(within(card).getByRole("link").getAttribute("href")).toBe("/control-room");
}

/** V19b — a rejected resolve read with a tab segment mounts no SMOC view (after V19a's positive control). */
export async function aRejectedReadWithATabMountsNoSmocView(): Promise<void> {
  stubReads(TWO_ORGS, "reject");
  renderAt("a1", undefined, "sld");

  expect(await screen.findByText(/not available in your access scope/)).toBeInTheDocument();
  expect(screen.queryByTestId("smoc-site-view")).toBeNull();
}

/**
 * V20 — D5: while the resolve read is pending, not even an unknown tab is
 * redirected — the loading line shows and the tab URL stays.
 */
export async function aPendingResolveReadDoesNotRedirect(): Promise<void> {
  stubReads(SMOC_SITES, SMOC_VIEW);
  const resolve = vi
    .spyOn(controlRoomApi, "fetchResolvedSiteControlRoomView")
    .mockImplementation(() => new Promise(() => undefined));
  renderAt("s1", undefined, "bogus");

  await waitFor(() => expect(resolve).toHaveBeenCalled());
  expect(await screen.findByText("Loading the site view…")).toBeInTheDocument();
  expect(pathname()).toBe("/control-room/site/s1/bogus");
}

/** V21a — `builtin/smoc` on a non-SMOC site (RSMOC-WC in PHEWB): the generated view mounts (L1). */
export async function aBuiltinOnANonSmocSiteHostsTheGeneratedView(): Promise<void> {
  stubReads(PHE_RSMOC_SITES, PHE_BUILTIN_VIEW);
  renderAt("p9");

  const mount = await screen.findByTestId("generated-site-view");
  expect(mount.getAttribute("data-location-id")).toBe("p9");
}

/** V21b — `builtin/smoc` on a non-SMOC site mounts no SMOC view (after V21a's positive control). */
export async function aBuiltinOnANonSmocSiteMountsNoSmocView(): Promise<void> {
  stubReads(PHE_RSMOC_SITES, PHE_BUILTIN_VIEW);
  renderAt("p9");

  expect(await screen.findByTestId("generated-site-view")).toBeInTheDocument();
  expect(screen.queryByTestId("smoc-site-view")).toBeNull();
}

/** V21c — a tab segment on a non-SMOC `builtin` site redirects to the bare site path (L1, D5). */
export async function aTabOnANonSmocBuiltinSiteRedirectsToTheBarePath(): Promise<void> {
  stubReads(PHE_RSMOC_SITES, PHE_BUILTIN_VIEW);
  renderAt("p9", undefined, "sld");

  expect(await screen.findByTestId("generated-site-view")).toBeInTheDocument();
  expect(pathname()).toBe("/control-room/site/p9");
}

export function cleanupPage(): void {
  cleanup();
  mounts.generated.length = 0;
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ scope: null });
  expect(networkCalls, "a read reached the network").toEqual([]);
}
