import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import { assetLabelOf } from "@bms/shared";
import { DEGRADATION_CARD_TITLE, DEGRADATION_DISCLAIMER } from "@bms/shared/contracts";
import type { DegradationAsset, DegradationResponse } from "@bms/shared/contracts";

import * as degradationApi from "../../api/degradation";
import { assetHistoryPath } from "../../lib/asset-history-range";
import { anAsset, anIndicator } from "../../lib/degradation.spec";
import { DegradationTrendCard } from "./degradation-trend-card";

/**
 * `E1.5b` / ADR 0138 (plan T2.4, R-p, Q3 (a); decisions 3–5) — the *Trending toward a limit —
 * advisory* card on the control-room organization and site pages: one row per asset with a
 * crossing, in the server's order, at most `DEGRADATION_CARD_MAX`; the asset links to its history
 * page; the nearest indicator's summary; the *Advisory* pill in the info tone, never a severity
 * colour. Nothing at all with no crossing, while pending, or on a failed read. The read is a spy
 * on the client. Entry point: `degradation-trend-card.test.tsx` (ADR 0014). Fixtures are made up.
 */
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";

/** Server order, not label or id order: the card must not re-sort. */
const SERVER_ORDER = [7, 3, 12, 1, 9, 4, 11, 2, 8, 5, 10, 6];

function crossingAsset(n: number): DegradationAsset {
  return anAsset(n, [
    anIndicator({ id: `${n}:health`, status: "beyond_horizon", daysToLimit: null, summary: `Beyond ${n}` }),
    anIndicator({
      id: `${n}:point_drift:supply_temp`,
      kind: "point_drift",
      pointKey: "supply_temp",
      unit: "°C",
      daysToLimit: { min: n, max: n + 4 },
      summary: `supply_temp trending up: reaches 12.5 °C in about ${n}–${n + 4} days`,
    }),
  ]);
}

function beyondOnlyAsset(n: number): DegradationAsset {
  return anAsset(n, [
    anIndicator({ id: `${n}:health`, status: "beyond_horizon", daysToLimit: null, summary: "Trending down: no limit within 90 days" }),
  ]);
}

function answer(assets: DegradationAsset[], over: Partial<DegradationResponse> = {}): DegradationResponse {
  return { asOf: "2026-11-16T10:20:00.000Z", candidates: assets.length, considered: assets.length, assets, ...over };
}

function renderCard(props: { organizationId?: string; locationId?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DegradationTrendCard {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function rows(): HTMLElement[] {
  return screen.queryAllByTestId("degradation-row");
}

const COLOUR = /critical|warning|severity|ok-/;

/** 12 assets with a crossing: 10 rows, in the server's order, each with its link, place, summary and pill. */
export async function tenRowsInTheServersOrder(): Promise<void> {
  const assets = SERVER_ORDER.map(crossingAsset);
  vi.spyOn(degradationApi, "fetchDegradation").mockResolvedValue(answer(assets, { considered: 200, candidates: 340 }));
  renderCard({ organizationId: ORG_ID });

  await waitFor(() => expect(rows()).toHaveLength(10));
  const card = screen.getByRole("heading", { name: DEGRADATION_CARD_TITLE }).closest("section") as HTMLElement;
  const drawn = rows();
  expect(drawn.map((row) => within(row).getByRole("link").textContent)).toEqual(
    assets.slice(0, 10).map((asset) => assetLabelOf(asset)),
  );
  drawn.forEach((row, i) => {
    const asset = assets[i] as DegradationAsset;
    const n = SERVER_ORDER[i] as number;
    expect(within(row).getByRole("link")).toHaveAttribute("href", assetHistoryPath(asset.assetId));
    expect(within(row).getByText(asset.assetLocationName)).toBeInTheDocument();
    expect(within(row).getByText(`supply_temp trending up: reaches 12.5 °C in about ${n}–${n + 4} days`)).toBeInTheDocument();
    expect(within(row).queryByText(`Beyond ${n}`)).toBeNull();
    const pill = within(row).getByText("Advisory");
    expect(pill.getAttribute("class") ?? "").toContain("text-info-ink");
  });
  expect(within(card).getByText(DEGRADATION_DISCLAIMER)).toBeInTheDocument();
  expect(within(card).getByText("Showing 200 of 340 assets.")).toBeInTheDocument();
}

/** With every candidate considered, no "Showing … of …" line. */
export async function noShownLineWhenAllWereConsidered(): Promise<void> {
  vi.spyOn(degradationApi, "fetchDegradation").mockResolvedValue(answer([crossingAsset(1)], { considered: 40, candidates: 40 }));
  renderCard();

  await waitFor(() => expect(rows()).toHaveLength(1));
  expect(screen.queryByText(/^Showing /)).toBeNull();
}

/** The card's filter reaches the client as the two keys, nothing else. */
export async function theFilterReachesTheClientAsTheTwoKeys(): Promise<void> {
  const spy = vi.spyOn(degradationApi, "fetchDegradation").mockResolvedValue(answer([crossingAsset(1)]));
  renderCard({ organizationId: ORG_ID, locationId: LOCATION_ID });

  await waitFor(() => expect(rows()).toHaveLength(1));
  expect(spy.mock.calls).toEqual([[{ organizationId: ORG_ID, locationId: LOCATION_ID }]]);
}

/** Role classes only: the pills are the info tone and no severity colour appears anywhere. */
export async function roleClassesOnlyNoSeverityColour(): Promise<void> {
  vi.spyOn(degradationApi, "fetchDegradation").mockResolvedValue(answer([crossingAsset(1), crossingAsset(2)]));
  const { container } = renderCard();

  await waitFor(() => expect(rows()).toHaveLength(2));
  const pills = screen.getAllByText("Advisory");
  expect(pills).toHaveLength(2);
  for (const pill of pills) {
    expect(pill.getAttribute("class") ?? "").toContain("border-info-line");
  }
  for (const el of [container, ...Array.from(container.querySelectorAll("*"))]) {
    expect(el.getAttribute("class") ?? "", el.outerHTML.slice(0, 120)).not.toMatch(COLOUR);
  }
}

function expectNothingDrawn(): void {
  expect(screen.queryByRole("heading", { name: DEGRADATION_CARD_TITLE })).toBeNull();
  expect(screen.queryByText(DEGRADATION_DISCLAIMER)).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(document.body.textContent ?? "").toBe("");
}

/** No asset with a crossing (none at all, or `beyond_horizon` only — Q3 (a)): nothing at all. */
export async function noCrossingDrawsNothing(): Promise<void> {
  const spy = vi
    .spyOn(degradationApi, "fetchDegradation")
    .mockResolvedValueOnce(answer([beyondOnlyAsset(1), beyondOnlyAsset(2)]))
    .mockResolvedValueOnce(answer([]));
  const first = renderCard();
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  await new Promise((r) => setTimeout(r, 20));
  expectNothingDrawn();
  first.unmount();

  renderCard();
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  await new Promise((r) => setTimeout(r, 20));
  expectNothingDrawn();
}

/** A pending read: nothing at all — no heading, no "Loading…". */
export async function aPendingReadDrawsNothing(): Promise<void> {
  const spy = vi.spyOn(degradationApi, "fetchDegradation").mockReturnValue(new Promise(() => undefined));
  renderCard();
  await waitFor(() => expect(spy).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
  expectNothingDrawn();
}

/** A failed read (a refused heavy route included, R-q): nothing at all, no banner. */
export async function aFailedReadDrawsNothing(): Promise<void> {
  const spy = vi.spyOn(degradationApi, "fetchDegradation").mockRejectedValue(new Error("degradation 429"));
  renderCard();
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  await new Promise((r) => setTimeout(r, 20));
  expectNothingDrawn();
}
