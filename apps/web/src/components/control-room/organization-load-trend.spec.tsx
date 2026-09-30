import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

import * as dashboardApi from "../../api/dashboard";
import { OrganizationLoadTrend } from "./organization-load-trend";

/**
 * `F3.72` U4, plan D3 — `OrganizationLoadTrend`, the organization level's load card: a plain
 * read of `GET /dashboard/load-trend?organizationId=`, no socket and no stale pill (the socket
 * sum is estate-wide).
 *
 * **The whole argument tuple is the claim.** `fetchLoadTrend(window, organizationId)` takes two
 * positional strings; a swapped pair compiles, so the read case asserts `mock.calls[0]` in full.
 *
 * `echarts-for-react` is stubbed to print the number of points the chart was given: the stub
 * is the positive control that the read's points reached the chart.
 *
 * Assertions live here; `organization-load-trend.test.tsx` is the Vitest entry point and
 * carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 */

vi.mock("echarts-for-react", () => ({
  default: ({ option }: { option: { series: { data: unknown[] }[] } }) => (
    <div data-testid="echarts-stub" data-points={String(option.series[0].data.length)} />
  ),
}));

const ORG_ID = "org-a";

function renderTrend(organizationId: string): void {
  vi.stubGlobal("fetch", () =>
    Promise.reject(new Error("organization-load-trend spec: an unstubbed read reached fetch")),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <OrganizationLoadTrend organizationId={organizationId} />
    </QueryClientProvider>,
  );
}

/** The card reads the 60-minute trend narrowed to its organization, and draws the points. */
export async function readsTheTrendForTheOrganization(): Promise<void> {
  const read = vi.spyOn(dashboardApi, "fetchLoadTrend").mockResolvedValue({
    points: [
      { t: "2026-09-30T10:00:00.000Z", totalKw: 12 },
      { t: "2026-09-30T10:01:00.000Z", totalKw: 14 },
    ],
  });
  renderTrend(ORG_ID);

  const chart = await screen.findByTestId("echarts-stub");
  expect(read.mock.calls[0]).toEqual(["60m", ORG_ID]);
  expect(chart.dataset.points).toBe("2");
  expect(screen.getByText("Load · last 60 minutes")).toBeInTheDocument();
}

/** No point in the window: the chart's empty state, and no chart. */
export async function anEmptyTrendShowsTheEmptyState(): Promise<void> {
  const read = vi.spyOn(dashboardApi, "fetchLoadTrend").mockResolvedValue({ points: [] });
  renderTrend(ORG_ID);

  expect(await screen.findByText(/No kW history yet/)).toBeInTheDocument();
  expect(read).toHaveBeenCalled();
  expect(screen.queryByTestId("echarts-stub")).toBeNull();
}

/** A rejected read: the chart's error state, and no chart. */
export async function aFailedReadShowsTheErrorState(): Promise<void> {
  const read = vi
    .spyOn(dashboardApi, "fetchLoadTrend")
    .mockRejectedValue(new Error("load-trend 500"));
  renderTrend(ORG_ID);

  expect(await screen.findByText("Could not load trend data.")).toBeInTheDocument();
  await waitFor(() => expect(read).toHaveBeenCalled());
  expect(screen.queryByTestId("echarts-stub")).toBeNull();
}

export function cleanupTrend(): void {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}
