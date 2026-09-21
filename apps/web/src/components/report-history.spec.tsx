import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { ReportFileDto } from "@bms/shared";

import * as reportsApi from "../api/reports";
import { ApiError } from "../lib/api-error";
import { formatBytes, periodLabel } from "../lib/report-files-view";
import { ReportHistory } from "./report-history";

/**
 * `F3.5a` Unit 11 — the History list (ADR 0071 decision 12; R-13, R-14).
 *
 * Assertions live here; `report-history.test.tsx` is the Vitest entry point
 * and carries the `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042
 * decision 2).
 *
 * Every row waits on what the **data** produces (a filename, a sentence the
 * query state renders), never on the "History" heading, which renders before
 * the query settles and would resolve at once.
 */

export const FIRST: ReportFileDto = {
  id: "0f0a4a1e-1111-4a5b-8c4d-000000000001",
  organizationId: "5c2c1b0e-2222-4a5b-8c4d-000000000010",
  templateId: "energy_consumption",
  format: "pdf",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-07",
  locationIds: [],
  contentType: "application/pdf",
  byteSize: 12_345,
  sha256: "a".repeat(64),
  filename: "energy-consumption-2026-09-01-to-2026-09-07.pdf",
  deliveryStatus: "none",
  deliveryError: null,
  scheduleId: null,
  createdBy: null,
  createdAt: "2026-09-08T06:00:00.000Z",
};

export const SECOND: ReportFileDto = {
  ...FIRST,
  id: "0f0a4a1e-1111-4a5b-8c4d-000000000002",
  format: "xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  byteSize: 67,
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  filename: "energy-consumption-2026-08-01-to-2026-08-31.xlsx",
  createdAt: "2026-09-01T06:00:00.000Z",
};

const UNAVAILABLE_503 = "Report history is unavailable: object storage is not configured";

function renderHistory(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReportHistory />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The `<tr>` holding `filename`, so a cell assertion cannot pass on the other row. */
async function rowFor(filename: string): Promise<HTMLElement> {
  const row = (await screen.findByText(filename)).closest("tr");
  expect(row, `no table row holds ${JSON.stringify(filename)}`).toBeTruthy();
  return row as HTMLElement;
}

/** The loading sentence renders while the list promise is still open. */
export async function theLoadingSentenceRendersWhileTheListIsOpen(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportFiles").mockReturnValue(new Promise<ReportFileDto[]>(() => {}));

  renderHistory();

  expect(await screen.findByText("Loading report history…")).toBeInTheDocument();
}

/** Two DTOs render two rows with the size, the period and the delivery label. */
export async function twoFilesRenderTwoRowsWithSizePeriodAndDelivery(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportFiles").mockResolvedValue([FIRST, SECOND]);

  renderHistory();

  const first = await rowFor(FIRST.filename);
  expect(within(first).getByText(formatBytes(FIRST.byteSize))).toBeInTheDocument();
  expect(within(first).getByText(periodLabel(FIRST))).toBeInTheDocument();
  expect(within(first).getByText("PDF")).toBeInTheDocument();
  expect(within(first).getByText("On demand")).toBeInTheDocument();

  const second = await rowFor(SECOND.filename);
  expect(within(second).getByText("67 B")).toBeInTheDocument();
  expect(within(second).getByText(periodLabel(SECOND))).toBeInTheDocument();
  expect(within(second).getByText("XLSX")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
}

/** Download hands the whole DTO to `downloadReportFile` — the filename comes from it. */
export async function downloadCallsTheApiWithTheDto(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportFiles").mockResolvedValue([FIRST, SECOND]);
  const download = vi.spyOn(reportsApi, "downloadReportFile").mockResolvedValue();

  renderHistory();

  const second = await rowFor(SECOND.filename);
  await userEvent.click(within(second).getByRole("button", { name: "Download" }));

  await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
  expect(download.mock.calls[0]?.[0]).toEqual(SECOND);
}

/** A refused download renders the API's own sentence beside the list. */
export async function aRefusedDownloadRendersTheApiSentence(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportFiles").mockResolvedValue([FIRST]);
  vi.spyOn(reportsApi, "downloadReportFile").mockRejectedValue(
    new ApiError("Report file is outside your access scope", 403),
  );

  renderHistory();

  const first = await rowFor(FIRST.filename);
  await userEvent.click(within(first).getByRole("button", { name: "Download" }));

  expect(await screen.findByText("Report file is outside your access scope")).toBeInTheDocument();
}

/**
 * Delete calls `deleteReportFile(id)` once, with that row's id, and the list
 * refetches — the spy's call count moves by exactly one.
 */
export async function deleteCallsTheApiOnceAndRefetchesTheList(): Promise<void> {
  const list = vi.spyOn(reportsApi, "fetchReportFiles").mockResolvedValue([FIRST, SECOND]);
  const remove = vi.spyOn(reportsApi, "deleteReportFile").mockResolvedValue();

  renderHistory();

  const second = await rowFor(SECOND.filename);
  const listCallsBefore = list.mock.calls.length;
  await userEvent.click(within(second).getByRole("button", { name: "Delete" }));

  await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  expect(remove.mock.calls[0]?.[0]).toBe(SECOND.id);
  await waitFor(() => expect(list.mock.calls.length).toBe(listCallsBefore + 1));
}

/**
 * Two deletes held open: the first row's button still says "Deleting…" after
 * the second starts (F3.4 post-merge sweep C2 — a single id was overwritten
 * by the second `onMutate`).
 *
 * Neither promise is released, so the claim is a positive state and not an
 * absence: both rows' buttons say "Deleting…" and both are disabled, located
 * inside their own rows so the two states cannot be on the wrong rows.
 */
export async function twoDeletesInFlightKeepBothButtonsPending(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportFiles").mockResolvedValue([FIRST, SECOND]);
  vi.spyOn(reportsApi, "deleteReportFile").mockReturnValue(new Promise<void>(() => {}));

  renderHistory();

  const first = await rowFor(FIRST.filename);
  const second = await rowFor(SECOND.filename);
  await userEvent.click(within(first).getByRole("button", { name: "Delete" }));
  expect(await within(first).findByRole("button", { name: "Deleting…" })).toBeDisabled();

  await userEvent.click(within(second).getByRole("button", { name: "Delete" }));
  expect(await within(second).findByRole("button", { name: "Deleting…" })).toBeDisabled();
  expect(within(first).getByRole("button", { name: "Deleting…" })).toBeDisabled();
}

/**
 * Releasing the first delete alone returns only the first row's button — the
 * positive control for the row above: a list that stayed "Deleting…" for ever
 * satisfies everything before this.
 */
export async function releasingOneDeleteFreesOnlyThatRowsButton(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportFiles").mockResolvedValue([FIRST, SECOND]);
  const releases = new Map<string, () => void>();
  vi.spyOn(reportsApi, "deleteReportFile").mockImplementation(
    (id: string) =>
      new Promise<void>((resolve) => {
        releases.set(id, () => resolve());
      }),
  );

  renderHistory();

  const first = await rowFor(FIRST.filename);
  const second = await rowFor(SECOND.filename);
  await userEvent.click(within(first).getByRole("button", { name: "Delete" }));
  await userEvent.click(within(second).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Deleting…" })).toHaveLength(2));

  releases.get(FIRST.id)?.();

  await waitFor(() => expect(within(first).getByRole("button", { name: "Delete" })).toBeEnabled());
  expect(within(second).getByRole("button", { name: "Deleting…" })).toBeDisabled();
}

/** An `ApiError` with status 503 renders the API's own sentence. */
export async function a503RendersTheApiSentence(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportFiles").mockRejectedValue(new ApiError(UNAVAILABLE_503, 503));

  renderHistory();

  expect(await screen.findByText(UNAVAILABLE_503)).toBeInTheDocument();
  expect(screen.queryByText("Report history unavailable.")).not.toBeInTheDocument();
}

/** Any other failure renders the generic sentence, never the raw body. */
export async function anotherErrorRendersTheGenericSentence(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportFiles").mockRejectedValue(new Error("report-files 500"));

  renderHistory();

  expect(await screen.findByText("Report history unavailable.")).toBeInTheDocument();
  expect(screen.queryByText("report-files 500")).not.toBeInTheDocument();
}

/** An empty list renders the empty sentence and no table. */
export async function anEmptyListRendersTheEmptySentence(): Promise<void> {
  vi.spyOn(reportsApi, "fetchReportFiles").mockResolvedValue([]);

  renderHistory();

  expect(await screen.findByText("No saved reports yet.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
}
