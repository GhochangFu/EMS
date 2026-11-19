import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi, type Mock } from "vitest";

import type { EnergyOrganizationViews, LocationKpiSummary } from "@bms/shared";

import * as energyApi from "../../api/energy-view";
import * as segmentApi from "../../api/segment-views";
import { siteTrendsPath } from "../../lib/smoc-pages";
import { site } from "../../pages/control-room/organizations-page.spec";
import { StationEnergyView } from "./station-energy-view";

/**
 * `F4.240` part b (ADR 0140 decision 3f, plan Task 2.5) — the station's Trends & Energy tab:
 * `SiteEnergyView` at the station (the subtree energy read) with the sites' bills in its bill slot,
 * one Trends link per site, and never `SiteTrendsView` or a segment read at the station.
 * `SiteEnergyView`, `StationBills` and `RangeCompareControls` are recording stand-ins; the
 * organization-views read is spied. Entry point: `station-energy-view.test.tsx`.
 */

vi.mock("./site-energy-view", () => ({
  SiteEnergyView: (props: { locationId: string; billSlot?: ReactNode }) => (
    <div data-testid="site-energy-view" data-location-id={props.locationId}>
      {props.billSlot}
    </div>
  ),
}));
vi.mock("./site-trends-view", () => ({
  SiteTrendsView: () => <div data-testid="site-trends-view" />,
}));
vi.mock("../energy/station-bills", () => ({
  StationBills: (props: { sites: readonly LocationKpiSummary[] }) => (
    <div data-testid="station-bills" data-site-ids={props.sites.map((entry) => entry.id).join(",")} />
  ),
}));
vi.mock("../energy/range-compare-controls", () => ({
  RangeCompareControls: (props: { timeZone: string | null }) => (
    <div data-testid="range-compare-controls" data-time-zone={props.timeZone ?? "(none)"} />
  ),
}));

const ORG = { id: "org-phewb", code: "PHEWB", name: "PHEWB" };
const STATION = "st";

function sitesWith(energyShown: [boolean, boolean]): LocationKpiSummary[] {
  return [
    { ...site({ id: "st-1", name: "Lotapata I", organization: ORG, energyShown: energyShown[0] }), parentId: STATION },
    { ...site({ id: "st-2", name: "Lotapata II", organization: ORG, energyShown: energyShown[1] }), parentId: STATION },
  ];
}

const ORG_VIEWS = { timeZone: "Asia/Kolkata" } as EnergyOrganizationViews;

let fetchSpy: Mock | null = null;
let orgViewsRead: Mock | null = null;
let segmentRead: Mock | null = null;

function stubReads(): void {
  fetchSpy = vi.fn(() => Promise.reject(new Error("a spec reached the network")));
  vi.stubGlobal("fetch", fetchSpy);
  orgViewsRead = vi.spyOn(energyApi, "fetchEnergyOrganizationViews").mockResolvedValue(ORG_VIEWS) as unknown as Mock;
  segmentRead = vi
    .spyOn(segmentApi, "fetchSiteSegmentViews")
    .mockImplementation(() => new Promise(() => undefined)) as unknown as Mock;
}

function renderView(sites: LocationKpiSummary[]): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/control-room/site/${STATION}/trends`]}>
        <StationEnergyView stationId={STATION} sites={sites} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** EV1 — `SiteEnergyView` gets the station id and a bill slot holding the sites' bills. */
export async function theEnergyViewIsTheStationsWithTheSiteBills(): Promise<void> {
  stubReads();
  renderView(sitesWith([true, true]));

  const energy = await screen.findByTestId("site-energy-view");
  expect(energy.getAttribute("data-location-id")).toBe(STATION);
  expect(within(energy).getByTestId("station-bills").getAttribute("data-site-ids")).toBe("st-1,st-2");
}

/** EV2 — no `SiteTrendsView` and no segment read, at the station or anywhere. */
export async function noSegmentReadAndNoSiteTrendsView(): Promise<void> {
  stubReads();
  renderView(sitesWith([true, true]));

  await screen.findByTestId("site-energy-view");
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
  expect(screen.queryByTestId("site-trends-view")).toBeNull();
  expect(segmentRead).not.toHaveBeenCalled();
}

/** EV3 — one "Trends" link per site, to the site's own Trends & Energy tab. */
export async function oneTrendsLinkPerSite(): Promise<void> {
  stubReads();
  const sites = sitesWith([true, true]);
  renderView(sites);

  const nav = await screen.findByRole("navigation", { name: "Site trends" });
  expect(
    within(nav)
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("aria-label"), link.getAttribute("href")]),
  ).toEqual(sites.map((entry) => ["Trends", `Open ${entry.name} trends`, siteTrendsPath(entry.id)]));
}

/** EV4 — the range controls get the zone from the organization-views answer at the station. */
export async function theRangeZoneIsTheOrganizationViewsZone(): Promise<void> {
  stubReads();
  renderView(sitesWith([true, true]));

  const controls = await screen.findByTestId("range-compare-controls");
  await waitFor(() => expect(controls.getAttribute("data-time-zone")).toBe("Asia/Kolkata"));
  expect(orgViewsRead?.mock.calls[0]?.[0]).toMatchObject({ locationIds: [STATION] });
}

/**
 * EV5 — no site shows energy: only the Trends links, no energy view, no range controls and no
 * energy read. One site showing energy keeps the energy view, with that site's bill only.
 */
export async function noEnergyShownShowsOnlyTheTrendsLinks(): Promise<void> {
  stubReads();
  renderView(sitesWith([false, false]));

  expect(await screen.findByRole("navigation", { name: "Site trends" })).toBeInTheDocument();
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
  expect(screen.queryByTestId("site-energy-view")).toBeNull();
  expect(screen.queryByTestId("range-compare-controls")).toBeNull();
  expect(orgViewsRead).not.toHaveBeenCalled();
  cleanupStationEnergy();

  stubReads();
  renderView(sitesWith([false, true]));
  expect((await screen.findByTestId("station-bills")).getAttribute("data-site-ids")).toBe("st-2");
}

/** Unmounts, restores the spies and fails the case if any read reached the network. */
export function cleanupStationEnergy(): void {
  cleanup();
  const networkCalls = fetchSpy?.mock.calls.map((call) => String(call[0])) ?? [];
  fetchSpy = null;
  orgViewsRead = null;
  segmentRead = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(networkCalls, "a read reached the network").toEqual([]);
}
