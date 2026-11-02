import { render, screen, within } from "@testing-library/react";
import { expect } from "vitest";

import type { EnergyView, EnergyViewPeriod } from "@bms/shared";

import type { KpiTileStatus } from "../kpi-tile";
import { EnergyKpiTiles } from "./energy-kpi-tiles";

/**
 * `F4.302` U3 (ADR 0108 Amendment 4 item 3) — the six Energy KPI tiles, drawn
 * from one `energy/view` answer without the page around them. The same claims
 * `energy-page.spec.tsx` makes through the whole page, here on the component
 * the site page reuses. Vitest entry: `energy-kpi-tiles.test.tsx`.
 */

function period(overrides: Partial<EnergyViewPeriod> = {}): EnergyViewPeriod {
  return {
    from: "2026-10-30T11:00:00.000Z",
    to: "2026-10-31T11:00:00.000Z",
    durationHours: 24,
    hasData: true,
    totalKwh: 2250,
    peakKw: 414.66,
    peakAt: "2026-10-31T11:12:00.000Z",
    avgPf: 0.934,
    pueEstimate: 1.25,
    indicativeCost: 5042.12,
    tariffPerKwh: 2.15,
    currency: "ZAR",
    sourceTotals: { gridKwh: 2000, solarKwh: 200, dgKwh: 50 },
    series: [],
    ...overrides,
  };
}

function view(overrides: Partial<EnergyView> = {}): EnergyView {
  return {
    organizationId: "6f1d2a3b-0000-4000-8000-000000000001",
    timeZone: "America/New_York",
    generatedAt: "2026-10-31T11:30:00.000Z",
    level: "1h",
    bucket: "1d",
    current: period(),
    compare: null,
    topConsumers: [],
    partial: null,
    ...overrides,
  };
}

function tile(label: string): HTMLElement {
  const card = screen.getByText(label).parentElement?.parentElement;
  expect(card, `no KpiTile is labelled ${JSON.stringify(label)}`).toBeTruthy();
  return card as HTMLElement;
}

function renderTiles(v: EnergyView | undefined, status: KpiTileStatus = "ready"): void {
  render(<EnergyKpiTiles status={status} view={v} />);
}

export function rendersTheSixTilesInOrder(): void {
  renderTiles(view());
  const labels = ["Total energy", "Peak demand", "Average PF", "Rollup", "PUE", "Indicative cost"];
  const text = document.body.textContent ?? "";
  const positions = labels.map((label) => text.indexOf(label));
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(positions.every((p) => p >= 0)).toBe(true);
}

export function theTotalTileShowsTheWholeKwh(): void {
  renderTiles(view());
  expect(tile("Total energy").textContent).toContain("2,250");
}

export function thePeakTileShowsThePeakKwNotTheTotal(): void {
  renderTiles(view());
  const peak = tile("Peak demand").textContent ?? "";
  expect(peak).toContain("415");
  expect(peak).not.toContain("2,250");
}

export function thePeakTimeIsInTheViewsZone(): void {
  renderTiles(view());
  expect(tile("Peak demand").textContent).toContain("Peak at 31 Oct, 07:12");
}

export function theTotalTileShowsTheChange(): void {
  renderTiles(view({ compare: period({ totalKwh: 2000 }) }));
  expect(within(tile("Total energy")).getByText("+12.5 % vs previous")).toBeInTheDocument();
}

export function anEmptyPreviousPeriodSaysSo(): void {
  renderTiles(view({ compare: period({ hasData: false, totalKwh: 0, peakKw: 0, peakAt: null, avgPf: null }) }));
  expect(within(tile("Total energy")).getByText("no data for the previous period")).toBeInTheDocument();
}

export function theRollupTileNamesLevelBucketAndZone(): void {
  renderTiles(view({ timeZone: "Asia/Kolkata" }));
  const rollup = tile("Rollup").textContent ?? "";
  expect(rollup).toContain("1h");
  expect(rollup).toContain("Asia/Kolkata");
}

export function aNullPueIsADashWithTheReason(): void {
  renderTiles(view({ current: period({ pueEstimate: null }) }));
  const pue = tile("PUE");
  expect(within(pue).getByText("Not configured — no incomer in scope computes site_kw and it_kw")).toBeInTheDocument();
  expect(within(pue).getByText("—")).toBeInTheDocument();
}

export function aNullCostIsADashWithTheReason(): void {
  renderTiles(view({ current: period({ indicativeCost: null, tariffPerKwh: null, currency: null }) }));
  const cost = tile("Indicative cost");
  expect(within(cost).getByText(/No tariff/)).toBeInTheDocument();
  expect(within(cost).getByText("—")).toBeInTheDocument();
}

export function aNullPfSaysNoPfPoint(): void {
  renderTiles(view({ current: period({ avgPf: null }) }));
  expect(within(tile("Average PF")).getByText("No pf point in scope")).toBeInTheDocument();
}

export function aPeriodWithoutDataSaysSo(): void {
  renderTiles(view({ current: period({ hasData: false }) }));
  expect(within(tile("Total energy")).getByText("No kW data in this period")).toBeInTheDocument();
}
