import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, vi, type MockInstance } from "vitest";

import type { FilterOptionsResponse, MlFindingsCard, MlFindingsSummaryResponse } from "@bms/shared/contracts";

import type { ForecastListRow, UserRole } from "@bms/shared";

import * as copilotApi from "../api/copilot";
import * as filterOptionsApi from "../api/filter-options";
import * as mlApi from "../api/ml";
import * as systemStatusApi from "../api/system-status";
import { OPERATIONAL } from "../components/system-status-indicator.spec";
import { IDS, ONE_ORG, OPTIONS } from "../lib/scope-filter.spec";
import type { AuthUser } from "../stores/auth-store";
import { FORECASTS_EMPTY_SENTENCE, ForecastsPage } from "./forecasts-page";

/**
 * `E1.4b` / ADR 0135 Amendment 3 R-e, C7, C8 — the Forecasts page. Assertions live here;
 * `forecasts-page.test.tsx` is the Vitest entry point and pins `TZ=America/St_Johns`, a zone no
 * fixture uses, so a time formatted in the browser's zone instead of the row's fails.
 */
const ASSET_A = "11111111-1111-4111-8111-111111111111";
const ASSET_B = "33333333-3333-4333-8333-333333333333";

function row(over: Partial<ForecastListRow> = {}): ForecastListRow {
  return {
    assetId: ASSET_A,
    assetCode: "CR-1",
    assetName: "Cold room 1",
    assetRtuName: "WBLDC RTU 1",
    locationId: "22222222-2222-4222-8222-222222222222",
    assetLocationName: "Kolkata DC",
    timeZone: "Asia/Kolkata",
    pointKey: "temp_c",
    unit: "°C",
    issuedAt: "2026-11-16T08:35:00.000Z",
    modelName: "amazon/chronos-2",
    modelVersion: "0".repeat(40),
    stale: false,
    p50Min: -18.456,
    p50Max: -17.2,
    p50PeakAt: "2026-11-16T12:00:00.000Z",
    ...over,
  };
}

/** Two rows in two zones: Kolkata (UTC+5:30) and Johannesburg (UTC+2). */
const ROWS: ForecastListRow[] = [
  row(),
  row({
    assetId: ASSET_B,
    assetCode: "CR-9",
    assetName: "Cold room 9",
    assetRtuName: null,
    assetLocationName: "Cape Town DC",
    timeZone: "Africa/Johannesburg",
    pointKey: "kw",
    unit: "kW",
    stale: true,
    p50Min: 3,
    p50Max: 7.5,
    issuedAt: "2026-11-16T04:05:00.000Z",
    p50PeakAt: "2026-11-17T01:00:00.000Z",
    modelName: "acme/forecaster-9",
  }),
];

function asUser(role: UserRole = "operator"): AuthUser {
  return { id: "u1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser;
}

const AS_OF = "2026-11-16T09:00:00.000Z";

/** The shell's reads, and (`E1.9b`) default filter options and an empty findings summary. */
function stubShell(): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(filterOptionsApi, "fetchFilterOptions").mockResolvedValue(OPTIONS);
  vi.spyOn(mlApi, "fetchMlFindingsSummary").mockResolvedValue({ asOf: "2026-11-16T09:00:00.000Z", cards: [] });
}

function stub(answer: ForecastListRow[] | Error) {
  stubShell();
  return answer instanceof Error
    ? vi.spyOn(mlApi, "fetchForecastList").mockRejectedValue(answer)
    : vi.spyOn(mlApi, "fetchForecastList").mockResolvedValue({ items: answer });
}

function renderPage(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/forecasts"]}>
        <ForecastsPage user={asUser()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

/** The table's body rows, in order, once the data has landed. */
async function bodyRows(): Promise<HTMLElement[]> {
  const table = await screen.findByRole("table");
  await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(1));
  return within(table).getAllByRole("row").slice(1);
}

/** Rows render in the server's order, each naming its site, asset and point. */
export async function rowsRenderInTheGivenOrder(): Promise<void> {
  stub(ROWS);
  renderPage();
  const rows = await bodyRows();
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain("Kolkata DC");
  expect(rows[0]?.textContent).toContain("CR-1 · WBLDC RTU 1");
  expect(rows[0]?.textContent).toContain("temp_c");
  expect(rows[1]?.textContent).toContain("Cape Town DC");
  // ADR 0111: no RTU, so the label names the location.
  expect(rows[1]?.textContent).toContain("CR-9 · Cape Town DC");
}

/** C7: each row's times are in its own site zone, never the browser's. */
export async function eachRowsTimesAreInItsOwnZone(): Promise<void> {
  stub(ROWS);
  renderPage();
  const [kolkata, capeTown] = await bodyRows();
  // 08:35Z is 14:05 in Kolkata; 12:00Z is 17:30 there.
  expect(within(kolkata as HTMLElement).getByTestId("forecast-issued").textContent).toBe("16 Nov 14:05");
  expect(within(kolkata as HTMLElement).getByTestId("forecast-peak").textContent).toBe("16 Nov 17:30");
  // 04:05Z is 06:05 in Johannesburg; 01:00Z on the 17th is 03:00 there.
  expect(within(capeTown as HTMLElement).getByTestId("forecast-issued").textContent).toBe("16 Nov 06:05");
  expect(within(capeTown as HTMLElement).getByTestId("forecast-peak").textContent).toBe("17 Nov 03:00");
}

/** A zone this browser does not know falls back to UTC, never a throw that blanks the page. */
export async function anUnknownZoneFallsBackToUtc(): Promise<void> {
  stub([row({ timeZone: "Not/AZone" })]);
  renderPage();
  const [only] = await bodyRows();
  expect(within(only as HTMLElement).getByTestId("forecast-issued").textContent).toBe("16 Nov 08:35");
  expect(within(only as HTMLElement).getByTestId("forecast-issued").getAttribute("title")).toBe("Not/AZone");
}

/** The range reads `min – max` with the unit; the model reads its label. */
export async function theRangeCarriesTheUnit(): Promise<void> {
  stub(ROWS);
  renderPage();
  const [kolkata, capeTown] = await bodyRows();
  expect(within(kolkata as HTMLElement).getByTestId("forecast-range").textContent).toBe("-18.46 – -17.2 °C");
  expect(within(capeTown as HTMLElement).getByTestId("forecast-range").textContent).toBe("3 – 7.5 kW");
  expect(kolkata?.textContent).toContain("Chronos-2");
  expect(capeTown?.textContent).toContain("acme/forecaster-9");
}

/** Fresh (the ok tone) and Stale (the warning tone) pills. */
export async function freshAndStalePills(): Promise<void> {
  stub(ROWS);
  renderPage();
  const [kolkata, capeTown] = await bodyRows();
  expect(within(kolkata as HTMLElement).getByText("Fresh").className).toContain("text-ok-ink");
  expect(within(capeTown as HTMLElement).getByText("Stale").className).toContain("text-warning-ink");
}

/** While the read is pending the page says it is loading, never the C8 "no forecasts" sentence. */
export async function aPendingReadIsLoadingNotEmpty(): Promise<void> {
  stubShell();
  vi.spyOn(mlApi, "fetchForecastList").mockReturnValue(new Promise(() => undefined));
  renderPage();
  expect(await screen.findByText("Loading forecasts…")).toBeInTheDocument();
  expect(screen.queryByText(FORECASTS_EMPTY_SENTENCE)).toBeNull();
}

/** The list is read again every 15 minutes, the forecast's own pace. */
export async function theListIsReadEveryFifteenMinutes(): Promise<void> {
  stub(ROWS);
  const client = renderPage();
  await bodyRows();
  const query = client.getQueryCache().find({ queryKey: ["ml-forecasts", null, null] });
  // An observer option, merged into the query's options at run time; `QueryOptions` does not declare it.
  expect((query?.options as { readonly refetchInterval?: unknown } | undefined)?.refetchInterval).toBe(900_000);
}

/** A row's link opens the asset's history with that point charted. */
export async function theLinkOpensTheHistoryWithThePoint(): Promise<void> {
  stub(ROWS);
  renderPage();
  const [kolkata] = await bodyRows();
  const link = within(kolkata as HTMLElement).getByRole("link");
  expect(link.getAttribute("href")).toBe(`/asset-history/${ASSET_A}?points=temp_c`);
}

/** C8: the empty list says exactly why. */
export async function anEmptyListSaysWhy(): Promise<void> {
  stub([]);
  renderPage();
  expect(await screen.findByText(FORECASTS_EMPTY_SENTENCE)).toBeInTheDocument();
  expect(FORECASTS_EMPTY_SENTENCE).toBe(
    "No forecasts yet. Forecasts are made for a few point types with enough recent real data.",
  );
}

/** R-g: the page says "advisory". */
export async function thePageSaysAdvisory(): Promise<void> {
  stub(ROWS);
  renderPage();
  await bodyRows();
  expect(screen.getByText("Advisory. The next 48 h from the latest model run.")).toBeInTheDocument();
}

/**
 * A failed read shows the error text, and no table. A 403 is final for `retryUnlessForbidden`, so
 * the read settles at once (a 500 would retry for about 3 s first: PR 3 code review).
 */
export async function aFailedReadShowsTheError(): Promise<void> {
  const spy = stub(new Error("ml forecasts 403"));
  renderPage();
  await waitFor(() => expect(spy).toHaveBeenCalled());
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the forecasts");
  expect(screen.queryByRole("table")).toBeNull();
}

/* ---------- `E1.9b` (ADR 0135 Amendment 8 decisions 1 and 8; plan T2.5) ---------- */

const SUMMARY_CARD: MlFindingsCard = {
  organizationId: IDS.ORG_A,
  organizationCode: "ORGA",
  organizationName: "Org A",
  facts: [{ id: "F1", segments: [{ text: "2 forecast points, issued at 16 Nov 14:05; 0 stale." }] }],
  assets: [],
};

function stubFilter(options: Promise<FilterOptionsResponse>, summary: Promise<MlFindingsSummaryResponse>) {
  vi.spyOn(filterOptionsApi, "fetchFilterOptions").mockReturnValue(options);
  return vi.spyOn(mlApi, "fetchMlFindingsSummary").mockReturnValue(summary);
}

function renderAt(entry: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <ForecastsPage user={asUser()} />
        <UrlProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function UrlProbe() {
  return <output data-testid="url">{useLocation().search}</output>;
}

function url(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId("url").textContent ?? "");
}

function picker(name: string): HTMLSelectElement {
  return screen.getByRole("combobox", { name }) as HTMLSelectElement;
}

/** The scope argument of every list call (`[filter]` or `[filter, since]`). */
function listFilters(list: { mock: { calls: unknown[][] } }): unknown[] {
  return list.mock.calls.map((call) => call[0]);
}

/** Exactly two pickers, Organization and Location; no Asset group or Asset picker. */
export async function onlyOrganizationAndLocationPickers(): Promise<void> {
  stub(ROWS);
  renderAt("/forecasts");
  await bodyRows();
  expect(screen.getAllByRole("combobox").map((c) => (c as HTMLSelectElement).labels?.[0]?.textContent)).toEqual([
    "Organization",
    "Location",
  ]);
  expect(screen.queryByRole("combobox", { name: "Asset group" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Asset" })).toBeNull();
}

/** Choosing an organization writes it into the URL, and both the list and the summary are read with it. */
export async function anOrganizationIsInTheUrlAndBothReads(): Promise<void> {
  const list = stub(ROWS);
  const summary = mlApi.fetchMlFindingsSummary as unknown as MockInstance<typeof mlApi.fetchMlFindingsSummary>;
  renderAt("/forecasts");
  await bodyRows();
  await vi.waitFor(() => expect(picker("Organization").disabled).toBe(false));
  await userEvent.selectOptions(picker("Organization"), IDS.ORG_A);
  await vi.waitFor(() => expect(url().get("organizationId")).toBe(IDS.ORG_A));
  await vi.waitFor(() => expect(listFilters(list).at(-1)).toEqual({ organizationId: IDS.ORG_A }));
  await vi.waitFor(() => expect(summary.mock.calls.at(-1)).toEqual(["forecasts", { organizationId: IDS.ORG_A }]));
}

/** A URL that already holds a location sends it (with its organization) on the first read. */
export async function aUrlLocationIsSentOnFirstLoad(): Promise<void> {
  const list = stub(ROWS);
  const summary = mlApi.fetchMlFindingsSummary as unknown as MockInstance<typeof mlApi.fetchMlFindingsSummary>;
  renderAt(`/forecasts?locationId=${IDS.SITE_B}`);
  await bodyRows();
  const expected = { organizationId: IDS.ORG_A, locationId: IDS.SITE_B };
  expect(listFilters(list)[0]).toEqual(expected);
  expect(summary.mock.calls[0]).toEqual(["forecasts", expected]);
}

/** `assetGroupId` in the URL is sent to neither read. */
export async function anAssetGroupInTheUrlIsSentToNeither(): Promise<void> {
  const list = stub(ROWS);
  const summary = mlApi.fetchMlFindingsSummary as unknown as MockInstance<typeof mlApi.fetchMlFindingsSummary>;
  renderAt(`/forecasts?organizationId=${IDS.ORG_A}&assetGroupId=${IDS.G_A1}&assetId=${IDS.AS_A1}`);
  await bodyRows();
  expect(list).toHaveBeenCalled();
  expect(summary).toHaveBeenCalled();
  for (const filter of listFilters(list)) {
    expect(filter).toEqual({ organizationId: IDS.ORG_A });
  }
  for (const call of summary.mock.calls) {
    expect(call).toEqual(["forecasts", { organizationId: IDS.ORG_A }]);
  }
}

/** A single-organization user sees the picker locked, and no `organizationId` is sent. */
export async function aSingleOrganizationIsLockedAndNotSent(): Promise<void> {
  const list = stub(ROWS);
  stubFilter(Promise.resolve(ONE_ORG), Promise.resolve({ asOf: AS_OF, cards: [] }));
  const summary = mlApi.fetchMlFindingsSummary as unknown as MockInstance<typeof mlApi.fetchMlFindingsSummary>;
  renderAt("/forecasts");
  await bodyRows();
  await vi.waitFor(() => expect(picker("Organization").value).toBe(IDS.ORG_X));
  expect(picker("Organization").disabled).toBe(true);
  expect(url().has("organizationId")).toBe(false);
  for (const filter of listFilters(list)) {
    expect(filter).toEqual({});
  }
  for (const call of summary.mock.calls) {
    expect(call).toEqual(["forecasts", {}]);
  }
}

/** While the options are pending and the URL names a scope, the table reads loading, never empty (`isPending`). */
export async function pendingOptionsWithAScopeReadLoading(): Promise<void> {
  const list = stub([]);
  stubFilter(new Promise(() => undefined), Promise.resolve({ asOf: AS_OF, cards: [] }));
  renderAt(`/forecasts?organizationId=${IDS.ORG_A}`);
  expect(await screen.findByText("Loading forecasts…")).toBeInTheDocument();
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.getByText("Loading forecasts…")).toBeInTheDocument();
  expect(screen.queryByText(FORECASTS_EMPTY_SENTENCE)).toBeNull();
  expect(list).not.toHaveBeenCalled();
}

/** The findings cards sit under the filter and above the table. */
export async function theCardsSitAboveTheTable(): Promise<void> {
  stub(ROWS);
  stubFilter(Promise.resolve(OPTIONS), Promise.resolve({ asOf: AS_OF, cards: [SUMMARY_CARD] }));
  renderAt("/forecasts");
  await bodyRows();
  const findings = await screen.findByRole("region", { name: "Findings — advisory" });
  expect(within(findings).getByText("2 forecast points, issued at 16 Nov 14:05; 0 stale.")).toBeInTheDocument();
  const table = screen.getByRole("table");
  expect(findings.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(picker("Organization").compareDocumentPosition(findings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

/** A failed summary read is one muted line, and the table still works. */
export async function aFailedSummaryLeavesTheTableWorking(): Promise<void> {
  stub(ROWS);
  stubFilter(Promise.resolve(OPTIONS), Promise.reject(new Error("ml findings summary 403")));
  renderAt("/forecasts");
  const rows = await bodyRows();
  expect(rows).toHaveLength(2);
  expect(await screen.findByText("Could not load the findings.")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
}
