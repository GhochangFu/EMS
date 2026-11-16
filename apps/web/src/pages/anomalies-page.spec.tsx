import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import { ANOMALY_LIST_MAX_ROWS } from "@bms/shared";
import type { AnomalyListRow, UserRole } from "@bms/shared";

import * as copilotApi from "../api/copilot";
import * as mlApi from "../api/ml";
import * as systemStatusApi from "../api/system-status";
import { OPERATIONAL } from "../components/system-status-indicator.spec";
import type { AuthUser } from "../stores/auth-store";
import {
  ANOMALIES_EMPTY_SENTENCE,
  ANOMALIES_ERROR_SENTENCE,
  ANOMALIES_SUBTITLE,
  ANOMALIES_TRUNCATED_SENTENCE,
  AnomaliesPage,
  formatAnomalyScore,
} from "./anomalies-page";

/**
 * `E1.2c` / ADR 0135 Amendment 5 ruling 4(a) — the Anomalies page (plan
 * `docs/plans/e1.2-anomaly-detection.md` §8). Assertions live here; `anomalies-page.test.tsx` is
 * the Vitest entry point and pins `TZ=America/St_Johns`, a zone no fixture uses, so an hour
 * formatted in the browser's zone instead of the row's fails. Fixtures are synthetic.
 */
const ASSET_A = "11111111-1111-4111-8111-111111111111";
const ASSET_B = "33333333-3333-4333-8333-333333333333";
const AS_OF = "2026-11-16T11:00:00.000Z";
const SINCE = "2026-11-09T11:00:00.000Z";

function row(over: Partial<AnomalyListRow> = {}): AnomalyListRow {
  return {
    assetId: ASSET_A,
    assetCode: "DEMO-M1",
    assetName: "Demo meter 1",
    assetRtuName: "DEMO RTU 1",
    locationId: "22222222-2222-4222-8222-222222222222",
    assetLocationName: "Kolkata DC",
    timeZone: "Asia/Kolkata",
    t: "2026-11-16T10:00:00.000Z",
    detector: "baseline_mad",
    score: 0.99871,
    contributingPoints: ["kw", "pf"],
    ...over,
  };
}

/** Two rows in two zones: Kolkata (UTC+5:30) and Johannesburg (UTC+2). */
const ROWS: AnomalyListRow[] = [
  row(),
  row({
    assetId: ASSET_B,
    assetCode: "DEMO-M9",
    assetName: "Demo meter 9",
    assetRtuName: null,
    assetLocationName: "Cape Town DC",
    timeZone: "Africa/Johannesburg",
    t: "2026-11-12T23:00:00.000Z",
    detector: "isolation_forest",
    score: 1,
    contributingPoints: ["kva"],
  }),
];

function asUser(role: UserRole = "operator"): AuthUser {
  return { id: "u1", email: `${role}@bms.local`, displayName: role, role } as unknown as AuthUser;
}

function stubShell(): void {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
}

function stub(answer: AnomalyListRow[] | Error, truncated = false) {
  stubShell();
  return answer instanceof Error
    ? vi.spyOn(mlApi, "fetchAnomalyList").mockRejectedValue(answer)
    : vi.spyOn(mlApi, "fetchAnomalyList").mockResolvedValue({ asOf: AS_OF, since: SINCE, truncated, items: answer });
}

function renderPage(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/anomalies"]}>
        <AnomaliesPage user={asUser()} />
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

/** Rows render in the server's order, each naming its site and asset (`assetLabelOf`, ADR 0111). */
export async function rowsRenderInTheGivenOrder(): Promise<void> {
  const spy = stub(ROWS);
  renderPage();
  const rows = await bodyRows();
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain("Kolkata DC");
  expect(rows[0]?.textContent).toContain("DEMO-M1 · DEMO RTU 1");
  expect(rows[1]?.textContent).toContain("Cape Town DC");
  // ADR 0111: no RTU, so the label names the location.
  expect(rows[1]?.textContent).toContain("DEMO-M9 · Cape Town DC");
  // The query function must not hand React Query's context to `since`.
  expect(spy.mock.calls[0]).toEqual([]);
}

/** Each row's hour is in its own site zone, never the browser's. */
export async function eachRowsHourIsInItsOwnZone(): Promise<void> {
  stub(ROWS);
  renderPage();
  const [kolkata, capeTown] = await bodyRows();
  // 10:00Z is 15:30 in Kolkata; 23:00Z on the 12th is 01:00 on the 13th in Johannesburg.
  expect(within(kolkata as HTMLElement).getByTestId("anomaly-hour").textContent).toBe("16 Nov 15:30");
  expect(within(capeTown as HTMLElement).getByTestId("anomaly-hour").textContent).toBe("13 Nov 01:00");
  expect(within(kolkata as HTMLElement).getByTestId("anomaly-hour").getAttribute("title")).toBe("Asia/Kolkata");
}

/** The score has three decimals; the detector reads its label; the points are joined. */
export async function scoreDetectorAndPoints(): Promise<void> {
  stub(ROWS);
  renderPage();
  const [kolkata, capeTown] = await bodyRows();
  expect(within(kolkata as HTMLElement).getByTestId("anomaly-score").textContent).toBe("0.998");
  expect(within(capeTown as HTMLElement).getByTestId("anomaly-score").textContent).toBe("1.000");
  expect(within(kolkata as HTMLElement).getByTestId("anomaly-detector").textContent).toBe("Baseline");
  expect(within(capeTown as HTMLElement).getByTestId("anomaly-detector").textContent).toBe("Isolation Forest");
  expect(within(kolkata as HTMLElement).getByTestId("anomaly-points").textContent).toBe("kw, pf");
  expect(within(capeTown as HTMLElement).getByTestId("anomaly-points").textContent).toBe("kva");
}

/** Status is an "Advisory" pill in the info tone, never an alarm tone. */
export async function statusIsAnAdvisoryPill(): Promise<void> {
  stub(ROWS);
  renderPage();
  const rows = await bodyRows();
  for (const r of rows) {
    expect(within(r).getByText("Advisory").className).toContain("text-info-ink");
  }
}

/**
 * A row's link opens the asset's history around that hour with its points charted:
 * `from = t − 24 h`, `to = min(t + 24 h, asOf)`, `points = contributingPoints`.
 */
export async function theLinkOpensTheHistoryAroundTheHour(): Promise<void> {
  stub(ROWS);
  renderPage();
  const [kolkata, capeTown] = await bodyRows();
  const parse = (r: HTMLElement): URL =>
    new URL(within(r).getByRole("link").getAttribute("href") ?? "", "http://x.invalid");

  const a = parse(kolkata as HTMLElement);
  expect(a.pathname).toBe(`/asset-history/${ASSET_A}`);
  expect(a.searchParams.get("from")).toBe("2026-11-15T10:00:00.000Z");
  // t + 24 h is past asOf, so `to` is clamped to asOf.
  expect(a.searchParams.get("to")).toBe(AS_OF);
  expect(a.searchParams.get("points")).toBe("kw,pf");

  const b = parse(capeTown as HTMLElement);
  expect(b.pathname).toBe(`/asset-history/${ASSET_B}`);
  expect(b.searchParams.get("from")).toBe("2026-11-11T23:00:00.000Z");
  expect(b.searchParams.get("to")).toBe("2026-11-13T23:00:00.000Z");
  expect(b.searchParams.get("points")).toBe("kva");
}

/** The empty list says exactly why. */
export async function anEmptyListSaysWhy(): Promise<void> {
  stub([]);
  renderPage();
  expect(await screen.findByText(ANOMALIES_EMPTY_SENTENCE)).toBeInTheDocument();
  expect(ANOMALIES_EMPTY_SENTENCE).toBe(
    "No unusual hours in the last 7 days. Scores are made for a few asset types with enough recent real data.",
  );
  expect(screen.queryByRole("table")).toBeNull();
}

/** A truncated list says so; a whole one does not. */
export async function aTruncatedListSaysSo(): Promise<void> {
  stub(ROWS, true);
  renderPage();
  await bodyRows();
  expect(screen.getByText(ANOMALIES_TRUNCATED_SENTENCE)).toBeInTheDocument();
  expect(ANOMALIES_TRUNCATED_SENTENCE).toBe(`Showing the newest ${ANOMALY_LIST_MAX_ROWS}.`);
}

/** A score just under 1 is truncated, never rounded up to 1.000; a drifted score is a dash. */
export function theScoreIsTruncatedAndGuarded(): void {
  expect(formatAnomalyScore(0.99951)).toBe("0.999");
  expect(formatAnomalyScore(0.9996)).toBe("0.999");
  expect(formatAnomalyScore(1)).toBe("1.000");
  expect(formatAnomalyScore(0.99)).toBe("0.990");
  expect(formatAnomalyScore(undefined)).toBe("—");
  expect(formatAnomalyScore(Number.NaN)).toBe("—");
}

/** A list that is whole never says it was cut. */
export async function aWholeListSaysNothingOfTruncation(): Promise<void> {
  stub(ROWS, false);
  renderPage();
  await bodyRows();
  expect(screen.queryByText(ANOMALIES_TRUNCATED_SENTENCE)).toBeNull();
}

/** Ruling 4(a): the page says "advisory", and no alarm language. */
export async function thePageSaysAdvisory(): Promise<void> {
  stub(ROWS);
  renderPage();
  await bodyRows();
  expect(screen.getByText(ANOMALIES_SUBTITLE)).toBeInTheDocument();
  expect(ANOMALIES_SUBTITLE).toBe(
    "Advisory. Hours in the last 7 days when an asset's readings were unusual against its own last 28 days.",
  );
  const main = screen.getByRole("main");
  expect(main.textContent ?? "").toMatch(/advisory/i);
  expect(main.textContent ?? "").not.toMatch(/alarm/i);
}

/** While the read is pending the page says it is loading, never the empty sentence. */
export async function aPendingReadIsLoadingNotEmpty(): Promise<void> {
  stubShell();
  vi.spyOn(mlApi, "fetchAnomalyList").mockReturnValue(new Promise(() => undefined));
  renderPage();
  expect(await screen.findByText("Loading unusual hours…")).toBeInTheDocument();
  expect(screen.queryByText(ANOMALIES_EMPTY_SENTENCE)).toBeNull();
}

/** The list is read again every 15 minutes. */
export async function theListIsReadEveryFifteenMinutes(): Promise<void> {
  stub(ROWS);
  const client = renderPage();
  await bodyRows();
  const query = client.getQueryCache().find({ queryKey: ["ml-anomalies"] });
  expect((query?.options as { readonly refetchInterval?: unknown } | undefined)?.refetchInterval).toBe(900_000);
}

/** A failed read is one fixed sentence, and no table. A 403 settles at once (`retryUnlessForbidden`). */
export async function aFailedReadShowsTheError(): Promise<void> {
  const spy = stub(new Error("ml anomalies 403"));
  renderPage();
  await waitFor(() => expect(spy).toHaveBeenCalled());
  expect(await screen.findByRole("alert")).toHaveTextContent(ANOMALIES_ERROR_SENTENCE);
  expect(ANOMALIES_ERROR_SENTENCE).toBe("Could not load the unusual hours.");
  expect(screen.queryByRole("table")).toBeNull();
}
