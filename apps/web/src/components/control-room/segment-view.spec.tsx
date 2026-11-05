import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { AppendChartWidgetResponse, DashboardDto, SiteSegmentViewsDto, UserRole } from "@bms/shared";

import * as dashboardsApi from "../../api/dashboards";
import { APPEND_ANSWER } from "../../api/dashboards.spec";
import { SEGMENT_VIEWS_BODY } from "../../api/segment-views.spec";
import { useAuthStore } from "../../stores/auth-store";
import { stubScheduleWizardApis } from "../view-actions/schedule-button.spec";
import { SegmentView } from "./segment-view";

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 items 2, 4, 8) — one segment sub-tab: the point selector, the
 * rollup line, the chart, the ranking and the abnormal list from one response; a segment whose
 * list holds no point shows the fixed sentence that points at Reference Data → Trend Points.
 * `echarts-for-react` is stubbed (jsdom has no canvas). Entry point: `segment-view.test.tsx`.
 */

vi.mock("echarts-for-react", () => ({ default: () => null }));

const BODY = {
  ...SEGMENT_VIEWS_BODY,
  points: [
    { code: "kw", name: "Power", unit: "kW" },
    { code: "pf", name: "Power factor", unit: null },
  ],
} as SiteSegmentViewsDto;

function renderView(data: SiteSegmentViewsDto, onPoint = vi.fn()): typeof onPoint {
  // The Schedule wizard reads through React Query once opened, so the tree always has a client.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SegmentView data={data} onPoint={onPoint} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onPoint;
}

/** The selector lists the segment's points, the current one chosen, and a choice reaches the caller. */
export function thePointSelectorListsThePointsAndEmitsAChoice(): void {
  const onPoint = renderView(BODY);
  const select = screen.getByRole("combobox", { name: "Trend point" }) as HTMLSelectElement;
  expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
    ["kw", "Power (kW)"],
    ["pf", "Power factor"],
  ]);
  expect(select.value).toBe("kw");
  fireEvent.change(select, { target: { value: "pf" } });
  expect(onPoint).toHaveBeenCalledWith("pf");
}

/** The rollup line names the level, the bucket and the site zone. */
export function theRollupLineNamesTheZone(): void {
  renderView(BODY);
  expect(screen.getByText("5m rollup · 5 minute buckets · Asia/Kolkata")).toBeInTheDocument();
}

/** A segment with no point in its list shows the fixed sentence and no selector. */
export function aSegmentWithNoPointsSaysWhereToAddThem(): void {
  renderView({ ...BODY, points: [], point: null });
  expect(
    screen.getByText("No trend point is listed for this segment. Add one in Reference Data → Trend Points."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Trend point" })).toBeNull();
}

const DRAWN_ASSET = "33333333-3333-4333-8333-333333333331";
const UNDRAWN_ASSET = "33333333-3333-4333-8333-333333333332";

function rankingEntry(assetId: string, drawn: boolean): SiteSegmentViewsDto["ranking"][number] {
  const stats = { mean: 10, max: 12, maxAt: null, sampleCount: 5 };
  return {
    assetId,
    assetCode: assetId.slice(-2),
    assetName: "Chiller",
    unit: "kW",
    current: stats,
    compare: null,
    buckets: drawn ? [{ t: "2026-10-30T00:00:00.000Z", v: 10 }] : null,
    compareBuckets: null,
  };
}

/** A sub-tab with one drawn series and one ranked past the chart cap. */
export const RANKED_BODY = {
  ...BODY,
  ranking: [rankingEntry(DRAWN_ASSET, true), rankingEntry(UNDRAWN_ASSET, false)],
} as SiteSegmentViewsDto;

/** Puts a signed-in user of `role` in the auth store; the test's `afterEach` clears it. */
export function signInAs(role: UserRole): void {
  useAuthStore.setState({ user: { id: "u1", email: `${role}@bms.local`, displayName: role, role } });
}

/** `F4.303` U15 — the Pin button sits in the sub-tab's control row for a role that may author dashboards. */
export function pinSitsInTheSubTabsControlRow(): void {
  signInAs("location_admin");
  renderView(RANKED_BODY);
  const select = screen.getByRole("combobox", { name: "Trend point" });
  const pin = screen.getByRole("button", { name: "Pin" });
  expect(select.compareDocumentPosition(pin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

/** `F4.303` U15 — an `operator` sees no Pin. */
export function anOperatorSeesNoPinOnASubTab(): void {
  signInAs("operator");
  renderView(RANKED_BODY);
  screen.getByRole("combobox", { name: "Trend point" });
  expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();
}

const PIN_TARGET: DashboardDto = {
  id: "88888888-8888-4888-8888-888888888888",
  organizationId: "99999999-9999-4999-8999-999999999999",
  slug: "plant",
  name: "Plant overview",
  description: null,
  locationId: null,
  assetGroupId: null,
  assetId: null,
  assetTemplateId: null,
  templateId: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  tabs: [],
  widgets: [],
};

const PIN_TARGET_SUMMARY = {
  id: PIN_TARGET.id,
  organizationId: PIN_TARGET.organizationId,
  slug: PIN_TARGET.slug,
  name: PIN_TARGET.name,
  description: null,
  locationId: null,
  assetGroupId: null,
  assetId: null,
  assetTemplateId: null,
  assetCode: null,
  assetRtuName: null,
  assetLocationName: null,
  createdAt: PIN_TARGET.createdAt,
  updatedAt: PIN_TARGET.updatedAt,
  widgetCount: 0,
};

/** `F4.303` U15 — the sub-tab pins its drawn series, `avg`, and the URL's preset length. */
export async function pinSendsTheDrawnSeriesAndTheUrlsPreset(): Promise<void> {
  signInAs("admin");
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue({ items: [PIN_TARGET_SUMMARY] });
  vi.spyOn(dashboardsApi, "fetchDashboard").mockResolvedValue(PIN_TARGET);
  const append = vi
    .spyOn(dashboardsApi, "appendChartWidget")
    .mockResolvedValue(APPEND_ANSWER as AppendChartWidgetResponse);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/trends?view=chillers&range=7d"]}>
        <SegmentView data={RANKED_BODY} onPoint={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Pin" }));
  const dialog = await screen.findByRole("dialog", { name: "Pin to a dashboard" });
  const select = within(dialog).getByRole("combobox", { name: "Dashboard" });
  await within(select).findByRole("option", { name: PIN_TARGET.name });
  fireEvent.change(select, { target: { value: PIN_TARGET.id } });
  const submit = within(dialog).getByRole("button", { name: "Pin to dashboard" });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
  expect(append.mock.calls[0]?.[1]).toMatchObject({
    config: { windowMinutes: 10080, aggregate: "avg" },
    points: [{ assetId: DRAWN_ASSET, pointKey: "kw" }],
  });
}

/** A trimmed chart names the cap. */
export function aTrimmedChartNamesTheCap(): void {
  renderView({ ...BODY, trimmed: true, seriesCount: 8 });
  expect(screen.getByText("The chart draws the top 8 assets by mean.")).toBeInTheDocument();
}

/** `F4.303` U16 (ADR 0108 Amendment 6 item 6): Schedule sits in the sub-tab's control row, after Pin. */
export function scheduleSitsAfterPinInTheSubTabsControlRow(): void {
  signInAs("location_admin");
  renderView(RANKED_BODY);
  const pin = screen.getByRole("button", { name: "Pin" });
  const schedule = screen.getByRole("button", { name: "Schedule" });
  expect(pin.compareDocumentPosition(schedule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

/** `F4.303` U16: an `asset_group_admin` may pin but not schedule (Pin is the adjacent positive claim). */
export function anAssetGroupAdminSeesNoSchedule(): void {
  signInAs("asset_group_admin");
  renderView(RANKED_BODY);
  screen.getByRole("button", { name: "Pin" });
  expect(screen.queryByRole("button", { name: "Schedule" })).toBeNull();
}

/** `F4.303` U16: the wizard opens with the sub-tab's drawn series only (one of the two ranked). */
export async function scheduleOpensWithTheDrawnSeriesOnly(): Promise<void> {
  stubScheduleWizardApis();
  signInAs("location_admin");
  renderView(RANKED_BODY);
  fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
  expect(await screen.findByText("Template: Trend points · 1 point")).toBeInTheDocument();
}
