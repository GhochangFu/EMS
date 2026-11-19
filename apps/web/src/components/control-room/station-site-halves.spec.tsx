import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import type { DashboardDto, LocationKpiSummary, ResolvedSiteControlRoomViewDto } from "@bms/shared";

import * as controlRoomApi from "../../api/control-room";
import * as dashboardsApi from "../../api/dashboards";
import { site } from "../../pages/control-room/organizations-page.spec";
import { StationSiteHalves } from "./station-site-halves";

/**
 * `F4.240` part b (ADR 0140 decision 3e, plan D8, D9, Task 2.3) — `StationSiteHalves`, both sites'
 * dashboard tabs side by side under one tab chooser at the station's route. `SiteDashboardView` and
 * `GeneratedSiteView` are recording stand-ins; the resolve read and the dashboard read are spied
 * per id and per slug, and `fetch` is a spy the cleanup fails the case on.
 *
 * Assertions live here; `station-site-halves.test.tsx` is the Vitest entry point and carries the
 * `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 */

vi.mock("./site-dashboard-view", () => ({
  SiteDashboardView: (props: Record<string, unknown>) => (
    <div data-testid="site-dashboard-view" data-props={JSON.stringify(props)} />
  ),
}));
vi.mock("./generated-site-view", () => ({
  GeneratedSiteView: (props: { locationId: string; energyShown: boolean }) => (
    <div data-testid="generated-site-view" data-location-id={props.locationId} data-energy-shown={String(props.energyShown)} />
  ),
}));

const ORG = { id: "org-phewb", code: "PHEWB", name: "PHEWB" };
const STATION = "st";
const STATION_PATH = `/control-room/site/${STATION}`;

const SITES: LocationKpiSummary[] = [
  { ...site({ id: "st-1", name: "Lotapata I", organization: ORG, energyShown: true }), parentId: STATION },
  { ...site({ id: "st-2", name: "Lotapata II", organization: ORG, energyShown: false }), parentId: STATION },
];

function tab(dashboardId: string, key: string, label: string, sortOrder: number): DashboardDto["tabs"][number] {
  return { id: `${dashboardId}-${key}`, dashboardId, organizationId: ORG.id, key, label, sortOrder, assetGroupId: null };
}

function dashboard(slug: string, locationId: string, tabs: [string, string][]): DashboardDto {
  return {
    id: `dash-${slug}`,
    organizationId: ORG.id,
    slug,
    name: `${slug} layout`,
    description: null,
    locationId,
    assetGroupId: null,
    assetId: null,
    assetTemplateId: null,
    templateId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    tabs: tabs.map(([key, label], index) => tab(`dash-${slug}`, key, label, index)),
    widgets: [],
  };
}

const D1 = dashboard("s1", "st-1", [
  ["overview", "Overview"],
  ["electrical", "Electrical"],
  ["environment", "Environment"],
]);
const D2 = dashboard("s2", "st-2", [
  ["overview", "Overview"],
  ["electrical", "Electrical"],
]);

function view(locationId: string, slug: string | null): ResolvedSiteControlRoomViewDto {
  return {
    locationId,
    kind: slug === null ? "generated" : "dashboard",
    dashboardId: slug === null ? null : `dash-${slug}`,
    dashboardSlug: slug,
    builtinKey: null,
    notice: null,
  };
}

let fetchSpy: Mock | null = null;
let resolveRead: Mock | null = null;
let dashboardRead: Mock | null = null;

/** Per site id: its slug (a `dashboard` view) or null (a `generated` view). Per slug: the DTO or "pending". */
function stubReads(
  slugs: Record<string, string | null>,
  dashboards: Record<string, DashboardDto | "pending"> = { s1: D1, s2: D2 },
): void {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  resolveRead = vi
    .spyOn(controlRoomApi, "fetchResolvedSiteControlRoomView")
    .mockImplementation((id: string) =>
      id in slugs ? Promise.resolve(view(id, slugs[id] ?? null)) : Promise.reject(new Error(`resolve ${id}`)),
    ) as unknown as Mock;
  dashboardRead = vi.spyOn(dashboardsApi, "fetchDashboard").mockImplementation((slug: string) => {
    const answer = dashboards[slug];
    if (answer === undefined) return Promise.reject(new Error(`dashboard ${slug}`));
    return answer === "pending" ? new Promise(() => undefined) : Promise.resolve(answer);
  }) as unknown as Mock;
}

function PathnameProbe() {
  const { pathname } = useLocation();
  return <p data-testid="pathname">{pathname}</p>;
}

function HalvesRoute() {
  const params = useParams();
  return <StationSiteHalves stationId={params.locationId ?? ""} sites={SITES} tab={params.tab} />;
}

function renderAt(path: string): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <PathnameProbe />
        <Routes>
          <Route path="/control-room/site/:locationId/:tab?" element={<HalvesRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

function pathname(): string {
  return screen.getByTestId("pathname").textContent ?? "";
}

function dashboardProps(): Record<string, unknown>[] {
  return screen
    .queryAllByTestId("site-dashboard-view")
    .map((el) => JSON.parse(el.getAttribute("data-props") ?? "null") as Record<string, unknown>);
}

function half(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

async function settle(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
}

/**
 * HV1 — the bare path: two `SiteDashboardView`s in list order, each with its own slug, location,
 * organization, `energyShown` and `embedded`, no `role`, and the first tab key. Mutation: hand both
 * halves the first site's slug => red.
 */
export async function bothHalvesMountTheirOwnDashboard(): Promise<void> {
  stubReads({ "st-1": "s1", "st-2": "s2" });
  renderAt(STATION_PATH);

  await waitFor(() => expect(dashboardProps()).toHaveLength(2));
  expect(dashboardProps()).toEqual([
    { slug: "s1", organizationId: ORG.id, locationId: "st-1", tab: "overview", energyShown: true, embedded: true },
    { slug: "s2", organizationId: ORG.id, locationId: "st-2", tab: "overview", energyShown: false, embedded: true },
  ]);
  expect(pathname()).toBe(STATION_PATH);
}

/** HV2 — at `/<station>/electrical` both halves get `electrical`; the chooser marks it current. */
export async function theSegmentChoosesBothHalvesTab(): Promise<void> {
  stubReads({ "st-1": "s1", "st-2": "s2" });
  renderAt(`${STATION_PATH}/electrical`);

  const chooser = await screen.findByRole("navigation", { name: "Station tabs" });
  await waitFor(() => expect(within(chooser).getAllByRole("link")).toHaveLength(3));
  expect(within(chooser).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Overview", `${STATION_PATH}/overview`],
    ["Electrical", `${STATION_PATH}/electrical`],
    ["Environment", `${STATION_PATH}/environment`],
  ]);
  expect(within(chooser).getByRole("link", { name: "Electrical" }).getAttribute("aria-current")).toBe("page");
  expect(within(chooser).getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBeNull();
  await waitFor(() => expect(dashboardProps().map((props) => props.tab)).toEqual(["electrical", "electrical"]));
}

/**
 * HV3 — a site whose dashboard lacks the chosen key shows "No <label> tab at this site" and mounts
 * no `SiteDashboardView`. Mutation: mount it with the key it lacks => red.
 */
export async function aHalfWithoutTheKeyShowsItsEmptyState(): Promise<void> {
  stubReads({ "st-1": "s1", "st-2": "s2" });
  renderAt(`${STATION_PATH}/environment`);

  expect(await within(await screen.findByRole("region", { name: "Lotapata II" })).findByText("No Environment tab at this site.")).toBeInTheDocument();
  await settle();
  expect(dashboardProps().map((props) => props.locationId)).toEqual(["st-1"]);
  expect(within(half("Lotapata II")).queryByTestId("site-dashboard-view")).toBeNull();
  expect(pathname()).toBe(`${STATION_PATH}/environment`);
}

/** HV4 — a site whose view is `generated` mounts `GeneratedSiteView` with its id, for every tab. */
export async function aGeneratedSiteMountsItsGeneratedView(): Promise<void> {
  for (const path of [STATION_PATH, `${STATION_PATH}/electrical`]) {
    stubReads({ "st-1": "s1", "st-2": null });
    renderAt(path);
    const generated = await within(await screen.findByRole("region", { name: "Lotapata II" })).findByTestId(
      "generated-site-view",
    );
    expect([generated.getAttribute("data-location-id"), generated.getAttribute("data-energy-shown")], path).toEqual([
      "st-2",
      "false",
    ]);
    await waitFor(() => expect(dashboardProps().map((props) => props.locationId), path).toEqual(["st-1"]));
    expect(pathname(), path).toBe(path);
    cleanupHalves();
  }
}

/**
 * HV5 — a segment no site holds redirects to the bare station path once every read has settled;
 * while one is pending there is no redirect. Mutation: redirect while a read is pending => red.
 */
export async function anUnknownSegmentRedirectsOnceSettled(): Promise<void> {
  stubReads({ "st-1": "s1", "st-2": "s2" }, { s1: D1, s2: "pending" });
  renderAt(`${STATION_PATH}/nope`);
  await waitFor(() => expect(dashboardRead).toHaveBeenCalledTimes(2));
  await settle();
  expect(pathname(), "no redirect while a read is pending").toBe(`${STATION_PATH}/nope`);
  cleanupHalves();

  stubReads({ "st-1": "s1", "st-2": "s2" });
  renderAt(`${STATION_PATH}/nope`);
  await waitFor(() => expect(pathname()).toBe(STATION_PATH));
}

/** HV6 — each half carries the site's name and a link to the site's own page. */
export async function eachHalfNamesAndLinksItsSite(): Promise<void> {
  stubReads({ "st-1": "s1", "st-2": "s2" });
  renderAt(STATION_PATH);

  for (const entry of SITES) {
    const region = await screen.findByRole("region", { name: entry.name });
    expect(within(region).getByRole("heading", { name: entry.name })).toBeInTheDocument();
    expect(within(region).getByRole("link", { name: `Open ${entry.name} site page` }).getAttribute("href")).toBe(
      `/control-room/site/${entry.id}`,
    );
  }
}

/**
 * HV7 — the resolve reads name the sites, never the station; the dashboard reads carry each site's
 * slug and organization; and both reads sit under the site page's own keys, so the cache is shared.
 */
export async function theReadsNameTheSitesUnderTheSharedKeys(): Promise<void> {
  stubReads({ "st-1": "s1", "st-2": "s2" });
  const queryClient = renderAt(STATION_PATH);

  await waitFor(() => expect(dashboardProps()).toHaveLength(2));
  expect(resolveRead?.mock.calls.map((call) => call[0])).toEqual(["st-1", "st-2"]);
  expect(dashboardRead?.mock.calls.map((call) => [call[0], call[1]])).toEqual([
    ["s1", ORG.id],
    ["s2", ORG.id],
  ]);
  for (const key of [
    ["control-room", "site-view", "st-1"],
    ["control-room", "site-view", "st-2"],
    ["dashboards", "detail", "s1", ORG.id],
    ["dashboards", "detail", "s2", ORG.id],
  ]) {
    expect(queryClient.getQueryData(key), key.join("/")).toBeDefined();
  }
}

/** Unmounts, restores the spies and fails the case if any read reached the network. */
export function cleanupHalves(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  resolveRead = null;
  dashboardRead = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(networkCalls, "a read reached the network").toEqual([]);
}
