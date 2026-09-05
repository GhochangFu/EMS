import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { EnergyReportPreview } from "@bms/shared";

import * as reportsApi from "../api/reports";
import { ReportsPanel } from "./reports-panel";

/**
 * `F2.8` — the Reports panel PUE tile, on a measured ratio and on a null.
 *
 * Assertions live here; `reports-panel.test.tsx` is the Vitest entry point and
 * carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042
 * decision 2).
 *
 * This tile is the screen beside the export, so it and `reports.serialise.ts`
 * have to agree on what "nothing configured" looks like: the panel renders the
 * `—` `KpiTile` draws for an empty tile and the CSV writes the same U+2014 in
 * the `PUE estimate` cell. Its old hint said "Prototype estimate", which is what
 * ruling 4 stops being true.
 */

const NOT_CONFIGURED = "Not configured — no incomer in scope computes site_kw and it_kw";
const MEASURED_HINT = "Σ site kW ÷ Σ IT kW, from the incomers' site_kw / it_kw";

function preview(pueEstimate: number | null): EnergyReportPreview {
  return {
    template: {
      id: "energy_consumption",
      title: "Energy Consumption",
      description: "Multi-site kWh, demand, PUE, cost, source mix, and top loads.",
      formats: ["CSV"],
      active: true,
    },
    range: { startDate: "2026-09-01", endDate: "2026-09-05", durationHours: 96 },
    generatedAt: "2026-09-05T12:00:00.000Z",
    summary: {
      window: "custom",
      totalKwh: 2345.17,
      peakKw: 414.66,
      pueEstimate,
      indicativeCostZar: 5042.12,
      tariffZarPerKwh: 2.15,
      asOf: "2026-09-05T12:00:00.000Z",
    },
    sourceTotals: { gridKwh: 2130.37, solarKwh: 126.04, dgKwh: 88.76 },
    topConsumers: [],
    notes: [],
  };
}

function renderPanel(pueEstimate: number | null): void {
  vi.spyOn(reportsApi, "fetchEnergyReportPreview").mockResolvedValue(preview(pueEstimate));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReportsPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** `KpiTile`'s label is a `span` in a flex row in the card, so the card is its grandparent. */
async function tileLabelled(label: string): Promise<HTMLElement> {
  const card = (await screen.findByText(label)).parentElement?.parentElement;
  expect(card, `no KpiTile is labelled ${JSON.stringify(label)}`).toBeTruthy();
  return card as HTMLElement;
}

/** A measured ratio renders to two decimals. */
export async function aMeasuredRatioRendersInTheReportsPanel(): Promise<void> {
  renderPanel(1.42);

  const tile = await tileLabelled("PUE");
  expect(await within(tile).findByText("1.42")).toBeInTheDocument();
  expect(within(tile).getByText(MEASURED_HINT)).toBeInTheDocument();
}

/** Nothing configured: the same dash the CSV export writes, and the reason. */
export async function anUnconfiguredPreviewShowsTheDashAndTheReason(): Promise<void> {
  renderPanel(null);

  const tile = await tileLabelled("PUE");
  expect(await within(tile).findByText("—")).toBeInTheDocument();
  expect(within(tile).getByText(NOT_CONFIGURED)).toBeInTheDocument();
}
