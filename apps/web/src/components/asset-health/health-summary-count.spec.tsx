import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { HealthSummaryResponse } from "@bms/shared";
import { healthBadActorsResponseSchema, healthSummaryResponseSchema } from "@bms/shared/contracts";
import type { HealthBadActorsResponse } from "@bms/shared/contracts";

import * as assetHealthApi from "../../api/asset-health";
import { HealthSummarySection } from "./health-summary-section";

/**
 * `E1.8b` T2.6 (plan §4.8, R-i; ADR 0050 Amendment 5) — the count line under the donut.
 * `health-summary-count.test.tsx` is the Vitest entry point and carries the jsdom docblock
 * (ADR 0014, ADR 0042 decision 2). `echarts-for-react` is mocked by the entry point: jsdom has
 * no canvas, and the donut's own legend is what shows it is on screen.
 */

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";

const SENTENCE = "3 of 20 scored assets lose points to anomaly history · advisory";

function summary(overrides: Partial<HealthSummaryResponse> = {}): HealthSummaryResponse {
  return healthSummaryResponseSchema.parse({
    score: 0.81,
    assetCount: 20,
    scoredAssetCount: 20,
    unbandedAssetCount: 0,
    unscoredAssetCount: 0,
    bandCounts: [{ code: "good", label: "Good", count: 20 }],
    windowFrom: "2026-11-17T09:00:00.000Z",
    windowTo: "2026-11-17T10:00:00.000Z",
    bucketSeconds: 300,
    computedAt: "2026-11-17T10:00:00.000Z",
    coveredBuckets: 12,
    expectedBuckets: 12,
    ...overrides,
  });
}

function badActors(losingAssetCount: number | null): HealthBadActorsResponse {
  return healthBadActorsResponseSchema.parse({
    asOf: "2026-11-17T10:00:00.000Z",
    scoredAssetCount: 20,
    lowestScores: [],
    anomaly:
      losingAssetCount === null
        ? null
        : { windowDays: 7, unusualAssetCount: losingAssetCount, losingAssetCount, caveat: null, items: [] },
  });
}

function renderSection(props: { organizationId?: string; locationId?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <HealthSummarySection {...props} />
    </QueryClientProvider>,
  );
}

/** The donut is on screen: its own "Scored" figure. */
async function donutOnScreen(): Promise<void> {
  expect(await screen.findByText("Scored")).toBeInTheDocument();
}

/** N ≥ 1: the sentence and the `info` pill, under the donut. */
export async function theLineAndThePillShowForAtLeastOne(): Promise<void> {
  vi.spyOn(assetHealthApi, "fetchHealthSummary").mockResolvedValue(summary());
  vi.spyOn(assetHealthApi, "fetchHealthBadActors").mockResolvedValue(badActors(3));
  const { container } = renderSection();

  const line = (await screen.findByText(SENTENCE)).closest("[data-testid='health-count-line']") as HTMLElement;
  expect(line).not.toBeNull();
  const pill = Array.from(line.querySelectorAll("span")).find((el) => el.textContent === "Advisory") as HTMLElement;
  expect(pill).toBeTruthy();
  expect(pill.className).toContain("border-info-line");
  for (const el of [line, ...Array.from(line.querySelectorAll("*"))]) {
    expect(el.getAttribute("class") ?? "").not.toMatch(/critical|warning|severity|ok-/);
  }
  const donutFigure = screen.getByText("Scored");
  expect(donutFigure.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING, "under the donut").not.toBe(0);
  expect(container.textContent).toContain("Good");
}

/** N = 0 (R-i), `anomaly: null`, and a rejected read: no line, no error, the donut as it was. */
export async function noLineForZeroNullOrARejectedRead(): Promise<void> {
  for (const answer of [badActors(0), badActors(null), new Error("asset-health/bad-actors 500")]) {
    vi.spyOn(assetHealthApi, "fetchHealthSummary").mockResolvedValue(summary());
    const spy = vi.spyOn(assetHealthApi, "fetchHealthBadActors");
    if (answer instanceof Error) {
      spy.mockRejectedValue(answer);
    } else {
      spy.mockResolvedValue(answer);
    }
    const view = renderSection();
    await donutOnScreen();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    // Let the read settle before asserting the absence.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.container.querySelector("[data-testid='health-count-line']")).toBeNull();
    expect(view.container.textContent).not.toContain("lose points");
    expect(view.container.textContent).not.toMatch(/could not|unavailable/i);
    view.unmount();
    vi.restoreAllMocks();
  }
}

/** The donut draws while the bad-actors read is still pending, with no line yet. */
export async function theDonutDoesNotWaitForTheCount(): Promise<void> {
  vi.spyOn(assetHealthApi, "fetchHealthSummary").mockResolvedValue(summary());
  const spy = vi.spyOn(assetHealthApi, "fetchHealthBadActors").mockReturnValue(new Promise(() => {}));
  const { container } = renderSection();

  await donutOnScreen();
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  expect(container.querySelector("[data-testid='health-count-line']")).toBeNull();
  expect(container.textContent).not.toContain("Loading");
}

/** An empty summary — no scored asset — makes no bad-actors request. */
export async function anEmptySummaryMakesNoBadActorsRequest(): Promise<void> {
  for (const empty of [
    summary({ assetCount: 0, scoredAssetCount: 0, unscoredAssetCount: 0, bandCounts: [] }),
    summary({ scoredAssetCount: 0, unscoredAssetCount: 20, bandCounts: [] }),
  ]) {
    const summarySpy = vi.spyOn(assetHealthApi, "fetchHealthSummary").mockResolvedValue(empty);
    const spy = vi.spyOn(assetHealthApi, "fetchHealthBadActors").mockResolvedValue(badActors(3));
    const view = renderSection();
    await waitFor(() => expect(summarySpy).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spy).not.toHaveBeenCalled();
    expect(view.container.textContent).not.toContain("lose points");
    view.unmount();
    vi.restoreAllMocks();
  }
}

/** The request carries the section's own scope, both fields. */
export async function theRequestCarriesTheSectionsScope(): Promise<void> {
  vi.spyOn(assetHealthApi, "fetchHealthSummary").mockResolvedValue(summary());
  const spy = vi.spyOn(assetHealthApi, "fetchHealthBadActors").mockResolvedValue(badActors(3));
  renderSection({ organizationId: ORG_ID, locationId: LOCATION_ID });

  await screen.findByText(SENTENCE);
  expect(spy.mock.calls).toEqual([[{ organizationId: ORG_ID, locationId: LOCATION_ID }]]);
}

/**
 * A cached answer never outlives the summary that allowed it (code review, E1.8b): a disabled
 * query still returns its cached data, so with a summary that holds no scored asset the line
 * must not draw even when a bad-actors answer for this scope is already in the cache.
 */
export async function aCachedAnswerDoesNotDrawWithoutAScoredAsset(): Promise<void> {
  vi.spyOn(assetHealthApi, "fetchHealthSummary").mockResolvedValue(
    summary({ scoredAssetCount: 0, unscoredAssetCount: 20, score: null, bandCounts: [] }),
  );
  const fetchBad = vi.spyOn(assetHealthApi, "fetchHealthBadActors").mockResolvedValue(badActors(3));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["asset-health", "bad-actors", null, ORG_ID], badActors(3));
  render(
    <QueryClientProvider client={queryClient}>
      <HealthSummarySection organizationId={ORG_ID} />
    </QueryClientProvider>,
  );
  await donutOnScreen();
  expect(screen.queryByText(SENTENCE)).toBeNull();
  expect(fetchBad).not.toHaveBeenCalled();
}
