import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi, type MockInstance } from "vitest";

import type {
  AppendChartWidgetBody,
  AppendChartWidgetResponse,
  DashboardDto,
  DashboardsListResponse,
  SiteSegmentViewsDto,
  UserRole,
} from "@bms/shared";

import * as dashboardsApi from "../../api/dashboards";
import { APPEND_ANSWER } from "../../api/dashboards.spec";
import { SEGMENT_VIEWS_BODY } from "../../api/segment-views.spec";
import { ApiError } from "../../lib/api-error";
import type { HistoryRange } from "../../lib/asset-history-range";
import { historyPinSource, PinButton, type PinSource, pinWindow, segmentPinSource } from "./pin-dialog";

/**
 * `F4.303` U15 (ADR 0108 Amendment 6 item 4) — Pin on a point view: the button shows for a role
 * that may author dashboards; the dialog lists the caller's dashboards and, on a tabbed one, its
 * tabs; it posts one trailing-window chart with the view's function, names the window for a span
 * that is not a preset, and says why a pin failed with a fixed sentence picked by status.
 *
 * Every dashboards client call is stubbed: an unstubbed one reaches a local API on :4000.
 * Entry point: `pin-dialog.test.tsx`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ASSET = "22222222-2222-4222-8222-222222222222";
const ASSET_B = "33333333-3333-4333-8333-333333333333";
const ASSET_C = "44444444-4444-4444-8444-444444444444";
const TABBED_ID = "55555555-5555-4555-8555-555555555551";
const PLAIN_ID = "55555555-5555-4555-8555-555555555552";

function summary(id: string, slug: string, name: string): DashboardsListResponse["items"][number] {
  return {
    id,
    organizationId: ORG,
    slug,
    name,
    description: null,
    locationId: null,
    assetGroupId: null,
    assetId: null,
    assetTemplateId: null,
    assetCode: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    widgetCount: 3,
  };
}

const LIST: DashboardsListResponse = {
  items: [summary(TABBED_ID, "plant", "Plant overview"), summary(PLAIN_ID, "chillers", "Chiller room")],
};

function tab(key: string, label: string, sortOrder: number): DashboardDto["tabs"][number] {
  return {
    id: `66666666-6666-4666-8666-66666666666${sortOrder}`,
    dashboardId: TABBED_ID,
    organizationId: ORG,
    key,
    label,
    sortOrder,
    assetGroupId: null,
  };
}

function dashboard(id: string, slug: string, name: string, tabs: DashboardDto["tabs"]): DashboardDto {
  return {
    id,
    organizationId: ORG,
    slug,
    name,
    description: null,
    locationId: null,
    assetGroupId: null,
    assetId: null,
    assetTemplateId: null,
    templateId: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    tabs,
    widgets: [],
  };
}

const TABBED = dashboard(TABBED_ID, "plant", "Plant overview", [tab("ops", "Operations", 0), tab("energy", "Energy", 1)]);
const PLAIN = dashboard(PLAIN_ID, "chillers", "Chiller room", []);

const PRESET_7D: HistoryRange = { range: "7d", compare: false, points: ["kw"], fn: "avg" };

interface Stubs {
  readonly append: MockInstance<typeof dashboardsApi.appendChartWidget>;
}

function stubDashboards(answer?: Error): Stubs {
  vi.spyOn(dashboardsApi, "fetchDashboards").mockResolvedValue(LIST);
  vi.spyOn(dashboardsApi, "fetchDashboard").mockImplementation(async (slug) => (slug === "plant" ? TABBED : PLAIN));
  const append = vi.spyOn(dashboardsApi, "appendChartWidget");
  if (answer) {
    append.mockRejectedValue(answer);
  } else {
    append.mockResolvedValue(APPEND_ANSWER as AppendChartWidgetResponse);
  }
  return { append };
}

function renderPin(source: PinSource, role: UserRole = "admin"): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PinButton role={role} source={source} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function historySource(range: HistoryRange, selected: readonly string[] = ["kw"]): PinSource {
  return historyPinSource("CHL-01", ASSET, range, selected);
}

async function openDialog(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "Pin" }));
  return screen.findByRole("dialog", { name: "Pin to a dashboard" });
}

/** Opens the dialog, picks the dashboard, and waits until its detail read has answered. */
async function chooseDashboard(id: string): Promise<HTMLElement> {
  const dialog = await openDialog();
  const select = await within(dialog).findByRole("combobox", { name: "Dashboard" });
  await within(select).findByRole("option", { name: "Plant overview" });
  fireEvent.change(select, { target: { value: id } });
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Pin to dashboard" })).toBeEnabled());
  return dialog;
}

/** Pins to the untabbed dashboard and answers the body sent. */
async function pinBody(source: PinSource): Promise<AppendChartWidgetBody> {
  const { append } = stubDashboards();
  renderPin(source);
  const dialog = await chooseDashboard(PLAIN_ID);
  fireEvent.click(within(dialog).getByRole("button", { name: "Pin to dashboard" }));
  await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
  expect(append.mock.calls[0]?.[0]).toBe(PLAIN_ID);
  const body = append.mock.calls[0]?.[1];
  if (body === undefined) {
    throw new Error("no body was sent");
  }
  return body;
}

/** Pins after the append fails with `error`; answers the dialog. */
async function pinFailing(error: Error): Promise<HTMLElement> {
  stubDashboards(error);
  renderPin(historySource(PRESET_7D));
  const dialog = await chooseDashboard(PLAIN_ID);
  fireEvent.click(within(dialog).getByRole("button", { name: "Pin to dashboard" }));
  await within(dialog).findByRole("alert");
  return dialog;
}

/** D1 — an `asset_group_admin` may author dashboards, so the button shows. */
export function theButtonShowsForAnAssetGroupAdmin(): void {
  stubDashboards();
  renderPin(historySource(PRESET_7D), "asset_group_admin");
  expect(screen.getByRole("button", { name: "Pin" })).toBeInTheDocument();
}

/** D1 — an `operator` may not, so there is no button. */
export function theButtonIsAbsentForAnOperator(): void {
  stubDashboards();
  renderPin(historySource(PRESET_7D), "operator");
  expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();
}

/** D2 — the dialog lists the caller's dashboards by name. */
export async function theDialogListsTheDashboards(): Promise<void> {
  stubDashboards();
  renderPin(historySource(PRESET_7D));
  const dialog = await openDialog();
  const select = await within(dialog).findByRole("combobox", { name: "Dashboard" });
  await within(select).findByRole("option", { name: "Plant overview" });
  const names = within(select)
    .getAllByRole("option")
    .map((o) => o.textContent);
  expect(names).toEqual(["Choose a dashboard", "Plant overview", "Chiller room"]);
}

/** D3 — a tabbed dashboard shows its tabs in order. */
export async function aTabbedDashboardShowsItsTabs(): Promise<void> {
  stubDashboards();
  renderPin(historySource(PRESET_7D));
  const dialog = await chooseDashboard(TABBED_ID);
  const tabs = within(dialog).getByRole("combobox", { name: "Tab" });
  expect(within(tabs).getAllByRole("option").map((o) => o.textContent)).toEqual(["Operations", "Energy"]);
}

/** D3 — an untabbed dashboard shows no tab select. */
export async function anUntabbedDashboardShowsNoTabSelect(): Promise<void> {
  stubDashboards();
  renderPin(historySource(PRESET_7D));
  const dialog = await chooseDashboard(PLAIN_ID);
  expect(within(dialog).queryByRole("combobox", { name: "Tab" })).toBeNull();
}

/** D3 — the chosen tab's key is sent. */
export async function theChosenTabIsSent(): Promise<void> {
  const { append } = stubDashboards();
  renderPin(historySource(PRESET_7D));
  const dialog = await chooseDashboard(TABBED_ID);
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Tab" }), { target: { value: "energy" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Pin to dashboard" }));
  await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
  expect(append.mock.calls[0]?.[1].tabKey).toBe("energy");
}

/** D3 — an untabbed dashboard is sent no `tabKey`. */
export async function anUntabbedDashboardIsSentNoTabKey(): Promise<void> {
  const body = await pinBody(historySource(PRESET_7D));
  expect("tabKey" in body).toBe(false);
}

/** D4 — a preset pins its own length. */
export async function aPresetPinsItsOwnLength(): Promise<void> {
  const body = await pinBody(historySource(PRESET_7D));
  expect(body.config.windowMinutes).toBe(10080);
}

/** D4 — a preset shows no window sentence. */
export async function aPresetShowsNoWindowSentence(): Promise<void> {
  stubDashboards();
  renderPin(historySource(PRESET_7D));
  const dialog = await chooseDashboard(PLAIN_ID);
  expect(within(dialog).queryByText(/^Pins the last/)).toBeNull();
}

const CUSTOM_36H30: HistoryRange = {
  range: "custom",
  from: "2026-11-01T00:00:00.000Z",
  to: "2026-11-02T12:30:00.000Z",
  compare: false,
  points: ["kw"],
  fn: "avg",
};

/** D4 — a custom range of 36 h 30 min pins 2 190 minutes. */
export async function aCustomRangePinsItsSpan(): Promise<void> {
  const body = await pinBody(historySource(CUSTOM_36H30));
  expect(body.config.windowMinutes).toBe(2190);
}

/** D4 — a custom range names the trailing window it pins. */
export async function aCustomRangeNamesTheWindow(): Promise<void> {
  stubDashboards();
  renderPin(historySource(CUSTOM_36H30));
  const dialog = await chooseDashboard(PLAIN_ID);
  expect(within(dialog).getByText("Pins the last 36 h 30 min, not these dates.")).toBeInTheDocument();
}

/** D4 — a span that is not a whole number of minutes rounds up: 36 h 29 min 30 s pins 2 190. */
export async function aPartMinuteSpanRoundsUp(): Promise<void> {
  const body = await pinBody(historySource({ ...CUSTOM_36H30, to: "2026-11-02T12:29:30.000Z" }));
  expect(body.config.windowMinutes).toBe(2190);
}

/** D5 — asset history pins its chosen points on its asset. */
export async function historySendsTheChosenPoints(): Promise<void> {
  const body = await pinBody(historySource({ ...PRESET_7D, fn: "max" }, ["kw", "pf"]));
  expect(body.points).toEqual([
    { assetId: ASSET, pointKey: "kw" },
    { assetId: ASSET, pointKey: "pf" },
  ]);
}

/** D5 — asset history pins with its own function. */
export async function historySendsItsFunction(): Promise<void> {
  const body = await pinBody(historySource({ ...PRESET_7D, fn: "max" }, ["kw", "pf"]));
  expect(body.config.aggregate).toBe("max");
}

function entry(assetId: string, code: string, drawn: boolean): SiteSegmentViewsDto["ranking"][number] {
  const stats = { mean: 10, max: 12, maxAt: null, sampleCount: 5 };
  return {
    assetId,
    assetCode: code,
    assetName: code,
    unit: "kW",
    current: stats,
    compare: null,
    buckets: drawn ? [{ t: "2026-10-30T00:00:00.000Z", v: 10 }] : null,
    compareBuckets: null,
  };
}

const SEGMENT = {
  ...SEGMENT_VIEWS_BODY,
  ranking: [entry(ASSET, "CH-1", true), entry(ASSET_B, "CH-2", true), entry(ASSET_C, "CH-3", false)],
} as SiteSegmentViewsDto;

/** D6 — a segment sub-tab pins only its drawn series, each on the sub-tab's point. */
export async function aSegmentSendsOnlyTheDrawnEntries(): Promise<void> {
  const body = await pinBody(segmentPinSource(SEGMENT, "24h"));
  expect(body.points).toEqual([
    { assetId: ASSET, pointKey: "kw" },
    { assetId: ASSET_B, pointKey: "kw" },
  ]);
}

/** D6 — a segment sub-tab pins the weighted mean it shows. */
export async function aSegmentSendsAvg(): Promise<void> {
  const body = await pinBody(segmentPinSource(SEGMENT, "24h"));
  expect(body.config.aggregate).toBe("avg");
}

/** D4 on a segment — `today` pins the span of the period the sub-tab shows (24 h here). */
export async function aSegmentTodayPinsThePeriodSpan(): Promise<void> {
  const body = await pinBody(segmentPinSource(SEGMENT, "today"));
  expect(body.config.windowMinutes).toBe(1440);
}

/** D7 — the chart's default size. */
export async function theChartsDefaultSizeIsSent(): Promise<void> {
  const body = await pinBody(historySource(PRESET_7D));
  expect([body.gridW, body.gridH]).toEqual([6, 4]);
}

/** The title defaults to the asset code and the points, and is sent as shown. */
export async function theDefaultTitleIsSent(): Promise<void> {
  const body = await pinBody(historySource(PRESET_7D, ["kw", "pf"]));
  expect(body.title).toBe("CHL-01 · kw, pf");
}

/** The submit is `aria-busy` while the append runs. */
export async function theSubmitIsBusyWhilePending(): Promise<void> {
  stubDashboards();
  let finish: (value: AppendChartWidgetResponse) => void = () => undefined;
  vi.mocked(dashboardsApi.appendChartWidget).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  renderPin(historySource(PRESET_7D));
  const dialog = await chooseDashboard(PLAIN_ID);
  fireEvent.click(within(dialog).getByRole("button", { name: "Pin to dashboard" }));
  const busy = await within(dialog).findByRole("button", { name: "Pinning…" });
  expect(busy).toHaveAttribute("aria-busy", "true");
  finish(APPEND_ANSWER as AppendChartWidgetResponse);
  await within(dialog).findByRole("status");
}

/** D8 — a 409 is the full-tab sentence. */
export async function aConflictIsTheFullTabSentence(): Promise<void> {
  const dialog = await pinFailing(new ApiError("SECRET", 409));
  expect(within(dialog).getByRole("alert").textContent).toBe("That tab is full (40 widgets).");
}

/** D8 — a 404 is the refused sentence. */
export async function aNotFoundIsTheRefusedSentence(): Promise<void> {
  const dialog = await pinFailing(new ApiError("SECRET", 404));
  expect(within(dialog).getByRole("alert").textContent).toBe("You cannot pin to that dashboard.");
}

/** D8 — a 403 is the refused sentence. */
export async function aForbiddenIsTheRefusedSentence(): Promise<void> {
  const dialog = await pinFailing(new ApiError("SECRET", 403));
  expect(within(dialog).getByRole("alert").textContent).toBe("You cannot pin to that dashboard.");
}

/** D8 — any other failure is "Pin failed.". */
export async function anyOtherFailureIsPinFailed(): Promise<void> {
  const dialog = await pinFailing(new ApiError("SECRET", 500));
  expect(within(dialog).getByRole("alert").textContent).toBe("Pin failed.");
}

/** D8 — the error's message is never rendered. */
export async function theErrorMessageIsNeverRendered(): Promise<void> {
  await pinFailing(new ApiError("SECRET", 400));
  expect(screen.queryByText(/SECRET/)).toBeNull();
}

/** D9 — success names the dashboard and links to it. */
export async function successLinksToTheDashboard(): Promise<void> {
  stubDashboards();
  renderPin(historySource(PRESET_7D));
  const dialog = await chooseDashboard(PLAIN_ID);
  fireEvent.click(within(dialog).getByRole("button", { name: "Pin to dashboard" }));
  const status = await screen.findByRole("status");
  expect(status.textContent).toBe("Pinned to Chiller room");
  expect(within(status).getByRole("link", { name: "Chiller room" })).toHaveAttribute(
    "href",
    `/dashboards/chillers?organizationId=${ORG}`,
  );
}

/** Review fix — after a pin the submit is disabled, so a second click appends no duplicate. */
export async function aPinnedDialogDisablesTheSubmit(): Promise<void> {
  stubDashboards();
  renderPin(historySource(PRESET_7D));
  const dialog = await chooseDashboard(PLAIN_ID);
  fireEvent.click(within(dialog).getByRole("button", { name: "Pin to dashboard" }));
  await within(dialog).findByRole("status");
  expect(within(dialog).getByRole("button", { name: "Pin to dashboard" })).toBeDisabled();
}

/** Review fix — another tab after a pin enables the submit again (the positive beside the one above). */
export async function anotherTabAfterAPinEnablesTheSubmit(): Promise<void> {
  stubDashboards();
  renderPin(historySource(PRESET_7D));
  const dialog = await chooseDashboard(TABBED_ID);
  fireEvent.click(within(dialog).getByRole("button", { name: "Pin to dashboard" }));
  await within(dialog).findByRole("status");
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Tab" }), { target: { value: "energy" } });
  expect(within(dialog).getByRole("button", { name: "Pin to dashboard" })).toBeEnabled();
}

const YEAR_MS = 525_600 * 60_000;

/** Review fix — a span of exactly `MAX_WIDGET_WINDOW_MINUTES` still pins. */
export function aSpanOfOneYearPins(): void {
  const to = new Date(Date.parse(CUSTOM_36H30.from ?? "") + YEAR_MS).toISOString();
  expect(pinWindow(historySource({ ...CUSTOM_36H30, to }))).toEqual({ minutes: 525_600, spanned: true });
}

/** Review fix — a span past `MAX_WIDGET_WINDOW_MINUTES` cannot be pinned (the route would refuse it). */
export function aSpanPastOneYearCannotBePinned(): void {
  const to = new Date(Date.parse(CUSTOM_36H30.from ?? "") + YEAR_MS + 60_000).toISOString();
  expect(pinWindow(historySource({ ...CUSTOM_36H30, to }))).toBeNull();
}
