import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { EnergyOrganizationViews, EnergyView } from "@bms/shared";

import * as billApi from "../../api/energy-bill";
import * as energyApi from "../../api/energy-view";
import type { SiteRankingSort } from "../../lib/energy-organization-views";
import { SiteEnergyView } from "./site-energy-view";

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 item 3) — the Energy sub-tab: the two energy reads locked to
 * the site (`locationIds=[site]`, no `organizationId`), the KPI tiles, the source mix, the top
 * consumers, the heatmap and the abnormal list; the site ranking only when the site has readable
 * children (`totalSites > 1`, owner 2026-11-02). Every api client is stubbed: an unstubbed fetch
 * reaches `:4000`. Entry point: `site-energy-view.test.tsx`.
 */

vi.mock("echarts-for-react", () => ({ default: () => null }));

const SITE = "11111111-1111-4111-8111-111111111111";
const CHILD = "22222222-2222-4222-8222-222222222222";

const VIEW: EnergyView = {
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  timeZone: "Asia/Kolkata",
  generatedAt: "2026-10-31T00:00:00.000Z",
  level: "5m",
  bucket: "5m",
  current: {
    from: "2026-10-30T00:00:00.000Z",
    to: "2026-10-30T23:59:59.999Z",
    durationHours: 24,
    hasData: true,
    totalKwh: 100,
    peakKw: 40,
    peakAt: "2026-10-30T12:00:00.000Z",
    avgPf: 0.9,
    pueEstimate: null,
    indicativeCost: null,
    tariffPerKwh: null,
    currency: null,
    tariffVerify: false,
    sourceTotals: { gridKwh: 100, solarKwh: 0, dgKwh: 0 },
    series: [],
    kwhPerM2: null,
  },
  compare: null,
  topConsumers: [],
  partial: null,
  floorArea: null,
};

function orgViews(totalSites: number): EnergyOrganizationViews {
  return {
    organizationId: VIEW.organizationId,
    timeZone: "Asia/Kolkata",
    generatedAt: VIEW.generatedAt,
    level: "5m",
    bucket: "5m",
    current: { from: VIEW.current.from, to: VIEW.current.to, durationHours: 24 },
    compare: null,
    sites: {
      current: [
        { locationId: SITE, name: "Parent plant", assetCount: 2, kwh: 60, peakKw: 30, peakAt: null, floorAreaM2: null, kwhPerM2: null },
        { locationId: CHILD, name: "Child unit", assetCount: 1, kwh: 40, peakKw: 20, peakAt: null, floorAreaM2: null, kwhPerM2: null },
      ].slice(0, totalSites),
      compare: null,
      totalSites,
    },
    trend: { columns: [], points: [] },
    heatmap: { cells: [] },
    abnormal: {
      baseline: { windows: 4, windowsConsulted: 4, stepDays: 1, ratio: 1.5 },
      entries: [],
      normalCount: { sites: 0, assets: 0 },
      truncated: false,
    },
    partial: null,
  };
}

/** `F4.304` U7 — the same view for a site with a floor area and its own figure. */
const VIEW_WITH_AREA: EnergyView = {
  ...VIEW,
  current: { ...VIEW.current, kwhPerM2: 0.3 },
  floorArea: { locationId: SITE, floorAreaM2: 200 },
};

function stubEnergy(orgAnswer: EnergyOrganizationViews | Error, viewAnswer: EnergyView = VIEW) {
  const viewSpy = vi.spyOn(energyApi, "fetchEnergyView").mockResolvedValue(viewAnswer);
  const orgSpy = vi.spyOn(energyApi, "fetchEnergyOrganizationViews");
  if (orgAnswer instanceof Error) {
    orgSpy.mockRejectedValue(orgAnswer);
  } else {
    orgSpy.mockResolvedValue(orgAnswer);
  }
  // `F4.365` U10: the monthly bill card's read; no mapping renders nothing, so the sections are unchanged.
  vi.spyOn(billApi, "fetchEnergyBill").mockResolvedValue({
    locationId: SITE,
    month: "2026-11",
    timeZone: "Asia/Kolkata",
    from: "2026-10-31T18:30:00.000Z",
    to: "2026-11-30T18:30:00.000Z",
    complete: false,
    currency: "INR",
    reason: "no_mapping",
    dataStatus: null,
    tariff: null,
    mapping: null,
    bill: null,
  });
  vi.spyOn(energyApi, "fetchEnergyFilterOptions").mockRejectedValue(new Error("not this view's read"));
  return { viewSpy, orgSpy };
}

function renderView(rankBy: SiteRankingSort = "kwh", onRankBy: (next: SiteRankingSort) => void = () => undefined): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SiteEnergyView locationId={SITE} value={{ range: "7d", compare: "previous" }} rankBy={rankBy} onRankBy={onRankBy} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** `F4.303` U6: the site ranking takes the section's `rankBy`, and a click hands the new key back. */
export async function theSiteRankingTakesTheSectionsRankBy(): Promise<void> {
  stubEnergy(orgViews(2));
  const onRankBy = vi.fn();
  renderView("peakKw", onRankBy);
  expect(await screen.findByRole("button", { name: "Peak kW" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "kWh per m²" }));
  expect(onRankBy).toHaveBeenCalledWith("kwhPerM2");
}

/** Both reads name the site in `locationIds` and send no `organizationId`. */
export async function bothReadsAreLockedToTheSite(): Promise<void> {
  const { viewSpy, orgSpy } = stubEnergy(orgViews(1));
  renderView();
  await waitFor(() => expect(orgSpy).toHaveBeenCalled());
  const expected = { range: "7d", locationIds: [SITE], compare: "previous" };
  expect(viewSpy.mock.calls[0]?.[0]).toEqual(expected);
  expect(orgSpy.mock.calls[0]?.[0]).toEqual(expected);
}

/** A flat site (`totalSites: 1`) shows no site ranking; the heatmap shows (positive control). */
export async function aFlatSiteShowsNoSiteRanking(): Promise<void> {
  stubEnergy(orgViews(1));
  renderView();
  expect(await screen.findByText("Consumption heatmap · kWh by day and hour")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("Loading the abnormal list…")).toBeNull());
  expect(screen.queryByText("Top consuming sites")).toBeNull();
}

/** A parent with readable children (`totalSites: 2`) shows the site ranking with both rows. */
export async function aParentSiteShowsTheSiteRanking(): Promise<void> {
  stubEnergy(orgViews(2));
  renderView();
  expect(await screen.findByText("Top consuming sites")).toBeInTheDocument();
  expect(await screen.findByText("Child unit")).toBeInTheDocument();
}

/** A failed organization read is a fixed sentence, never the error's message (`F4.204`). */
export async function aFailedOrganizationReadIsAFixedSentence(): Promise<void> {
  stubEnergy(new Error("reports/energy/organization-views 503 secret"));
  renderView();
  expect(await screen.findByText("Could not load the site's energy views.")).toBeInTheDocument();
  expect(screen.queryByText(/secret/)).toBeNull();
}

/** The KPI tiles render from the view read. */
export async function theKpiTilesRender(): Promise<void> {
  stubEnergy(orgViews(1));
  renderView();
  expect(await screen.findByText("5m rollup · 5 minute buckets · Asia/Kolkata")).toBeInTheDocument();
}

/** `F4.304` U7: the site tab carries the seventh tile, kWh per m², with the server's figure. */
export async function theSiteTabShowsTheKwhPerM2Tile(): Promise<void> {
  stubEnergy(orgViews(1), VIEW_WITH_AREA);
  renderView();
  expect(await screen.findByText("kWh per m²")).toBeInTheDocument();
  expect(await screen.findByTitle("0.30 kWh/m²")).toBeInTheDocument();
}

/** `F4.304` U7: a parent with readable children says the figure is its own assets'. */
export async function aParentSiteShowsTheOwnAssetsHint(): Promise<void> {
  stubEnergy(orgViews(2), VIEW_WITH_AREA);
  renderView();
  expect(await screen.findByText("This site's own assets ÷ its floor area")).toBeInTheDocument();
}

/** The negative pair: a flat site (`totalSites: 1`) carries no such hint once the tile is ready. */
export async function aFlatSiteShowsNoOwnAssetsHint(): Promise<void> {
  stubEnergy(orgViews(1), VIEW_WITH_AREA);
  renderView();
  expect(await screen.findByTitle("0.30 kWh/m²")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("Loading the abnormal list…")).toBeNull());
  expect(screen.queryByText("This site's own assets ÷ its floor area")).toBeNull();
}
